const { Favorites } = require("../../../commonModules/favorites/Favorite");
const { getWithFilters } = require('@dbUtils/queryUtil');
const { getMinTicketPricesByEventIds } = require("../ticketing/ticketingsRepository");
const { Events } = require("@EventsModel");
const mongoose = require("mongoose");
const EngagementEvents = require("@EngagementEventsModel");
/**
 * Toggle favorite for a user and target
 * If already favorited → remove it
 * If not → add it
 */
const toggleFavorite = async (userId, targetId, targetType) => {
    const filter = { user: userId, targetId, targetType };
    const existing = await Favorites.findOne(filter);

    if (existing) {
        await Favorites.deleteOne(filter);
        return { isFavorited: false };
    } else {
        await Favorites.create(filter);
        return { isFavorited: true };
    }
};

/**
 * Check if a user has favorited a target
 */
const isFavorited = async (userId, targetId, targetType) => {
    const exists = await Favorites.exists({ user: userId, targetId, targetType });
    return !!exists;
};

/**
 * Count total favorites for a target
 */
const countFavorites = async (filter) => {
    return Favorites.countDocuments(filter);
};

const getUserFavorites = async (userId, targetType, page, limit) => {
    let filter = { user: userId };
    if (targetType) {
        filter.targetType = targetType;
        let filtered = await getWithFilters({
            model: Favorites,
            query: filter,
            refPath: "targetType",
            localField: "targetId",
            refLookups,
            options: { page, limit },
        });

        // REMOVE records where lookup failed
        filtered = filtered.filter(fav => fav.object);

        return filtered;
    } else {
        // Return both events and organizations favorites in parallel
        const [eventsRaw, organizationsRaw] = await Promise.all([
            getWithFilters({
                model: Favorites,
                query: { user: userId, targetType: 'event' },
                refPath: "targetType",
                localField: "targetId",
                refLookups,
                options: { page, limit: 10 },
            }),
            getWithFilters({
                model: Favorites,
                query: { user: userId, targetType: 'organization' },
                refPath: "targetType",
                localField: "targetId",
                refLookups,
                options: { page, limit: 10 },
            }),
        ]);

        // FILTER NULL TARGETS
        const events = eventsRaw.filter(e => e.object);
        const organizations = organizationsRaw.filter(o => o.object);
        return {
            events,
            organizations,
        }
    }

};

const refLookups = {
    event: {
        from: "events",
        project: { "basicInfo.title": 1, "basicInfo.media": 1, "basicInfo.organization": 1, "basicInfo.venueLocation": 1, schedule: 1 },
        subLookups: [
            {
                from: "organizations",
                as: "basicInfo.organization",
                localField: "basicInfo.organization",
                project: { "basicInfo.name": 1, "basicInfo.media": 1, },
                single: true,
            },
        ],
    },
    organization: {
        from: "organizations",
        project: {
            "basicInfo.name": 1,
            "basicInfo.media.logo": 1,
            location: 1,
            "otherInfo.categories": 1,
        },
        subLookups: [
            {
                from: "categories",
                as: "otherInfo.categories",
                localField: "otherInfo.categories",
                project: { _id: 1, title: 1, image: 1 },
            },
        ],
    },
    menu: {
        from: "menus",
        project: { "title": 1, },

    },

}



const getUserEventEngagementDetails = async (userId) => {
    try {
        // Aggregate everything in one database call
        const eventsWithEngagementStats = await Favorites.aggregate([
            {
                // Step 1: Match favorite events for the given user and targetType = "event"
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    targetType: "event"
                }
            },
            {
                // Step 2: Look up the event details from the "events" collection
                $lookup: {
                    from: "events",  // Assuming the event collection is called "events"
                    localField: "targetId",  // From the favorites collection
                    foreignField: "_id",  // Match the targetId to _id in events
                    pipeline: [
                        {
                            $project: {
                                "basicInfo.title": 1,
                                _id: 1
                            }
                        }
                    ],
                    as: "eventDetails"  // The resulting array of events will be stored in "eventDetails"
                }
            },
            {
                // Step 3: Look up engagement stats for the matched events
                $lookup: {
                    from: "engagementevents",  // Engagement stats collection
                    let: { eventId: "$targetId" },  // Using the targetId (event ID)
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$entityId", "$$eventId"] },  // Match the entityId (event ID)
                                action: { $in: ["view", "favorite", "share", "open"] }  // Filter by specific actions
                            }
                        },
                        {
                            $group: {
                                _id: "$entityId",  // Group by event ID
                                viewCount: { $sum: { $cond: [{ $eq: ["$action", "view"] }, 1, 0] } },  // Count views
                                favoriteCount: { $sum: { $cond: [{ $eq: ["$action", "favorite"] }, 1, 0] } },  // Count favorites
                                shareCount: { $sum: { $cond: [{ $eq: ["$action", "share"] }, 1, 0] } },  // Count shares
                                openCount: { $sum: { $cond: [{ $eq: ["$action", "open"] }, 1, 0] } }  // Count opens
                            }
                        }
                    ],
                    as: "engagementStats"  // Resulting engagement stats will be stored in "engagementStats"
                }
            },
            {
                // Step 4: Flatten the arrays from the lookup and set defaults for missing stats
                $addFields: {
                    eventDetails: { $arrayElemAt: ["$eventDetails", 0] },  // Get the first (and only) event object
                    views: { $ifNull: [{ $arrayElemAt: ["$engagementStats.viewCount", 0] }, 0] },
                    favorites: { $ifNull: [{ $arrayElemAt: ["$engagementStats.favoriteCount", 0] }, 0] },
                    shares: { $ifNull: [{ $arrayElemAt: ["$engagementStats.shareCount", 0] }, 0] },
                    opens: { $ifNull: [{ $arrayElemAt: ["$engagementStats.openCount", 0] }, 0] }
                }
            },
            {
                $project: {
                    _id: 0,
                    eventDetails: 1,  
                    views: 1,
                    favorites: 1,
                    shares: 1,
                    opens: 1
                }
            },
            {
                $group: {
                    _id: null,
                    views: { $sum: "$views" },
                    favorites: { $sum: "$favorites" },
                    shares: { $sum: "$shares" },
                    opens: { $sum: "$opens" },
                    events: { $push: { eventDetails: "$eventDetails", views: "$views", favorites: "$favorites", shares: "$shares", opens: "$opens" } }
                }
            }
        ]);

        // If no favorite events or engagement stats, return an empty object
        if (eventsWithEngagementStats.length === 0) return {};

        return eventsWithEngagementStats[0];
    } catch (error) {
      
        throw error;
    }
};


module.exports = {
    toggleFavorite,
    isFavorited,
    countFavorites,
    getUserFavorites,
    getUserEventEngagementDetails
};
