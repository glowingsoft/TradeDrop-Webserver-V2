const { getFullImageUrl } = require("../../../../helperUtils/imageHelper");
const { calculateDistance } = require("../../../../helperUtils/calculateDistance");
const { formatEventSchedule } = require("../../../roles/admin/events/formatter/eventFormatter");
const { formatCategories } = require("../../../admin/categories/formatters/categoryFormatter");

/**
 * Formats an event document into a public-friendly JSON response.
 * Handles populated fields, media URLs, and timezone-aware date conversion.
 *
 * @param {Object} eventObject - Mongoose doc or plain object
 * @param {Object} options - optional settings: { timezone, includeFields, excludeFields }
 */
const formatFavoritesEventResponse = (eventObject, options = {}) => {
  if (!eventObject) return null;


  const { userLocation, timezone } = options;

  // Convert Mongoose document to plain object
  const event = JSON.parse(JSON.stringify(eventObject));
  // Only mutate/format fields that need formatting, keep rest as is
  if (event.basicInfo) {
    // Format media
    if (event.basicInfo.media) {
      event.basicInfo.media = getFullImageUrl(event.basicInfo.media.name);
    }
    // Calculate distance if both venueLocation and userLocation exist
    if (event.basicInfo.venueLocation?.coordinates && userLocation?.coordinates) {
      event.distance = calculateDistance(
        ...event.basicInfo.venueLocation.coordinates,
        ...userLocation.coordinates
      );
    }
    // Format organization if present
    if (event.basicInfo.organization) {
      const org = event.basicInfo.organization;
      event.basicInfo.organization = {
        _id: org._id,
        basicInfo: {
          name: org.basicInfo?.name || "",
          media: {
            logo: getFullImageUrl(org.basicInfo?.media?.logo),
          },
        },
      };
    }
  }


  // Format schedule
  event.schedule = formatEventSchedule(event.schedule, timezone);
  delete event.basicInfo?.venueLocation;
  event.isFavorite = true;

  return event;
};


function formatFavoritesOrganization(item, options = {}) {

  let org = typeof item.toObject === "function" ? item.toObject() : item;
  if (!org) return null;

  delete org.__v;

  // Handle media transformation for aggregation structure
  if (org.basicInfo?.media?.logo) {
    const logoName = org.basicInfo.media.logo;
    org.basicInfo.media.logo = getFullImageUrl(logoName);
  }


  // also transform otherInfo.categories if they are populated and not just ObjectIds
  if (org.otherInfo?.categories && Array.isArray(org.otherInfo.categories)) {
    // Check if at least one element is a populated object (not just ObjectId or string)
    const hasPopulated = org.otherInfo.categories.some(
      cat =>
        cat &&
        typeof cat === 'object' &&
        cat._id &&
        // Exclude plain ObjectId objects (which have only _id and no other keys)
        (Object.keys(cat).length > 1 || (cat.title || cat.name))
    );
    if (hasPopulated) {
      org.otherInfo.categories = formatCategories(org.otherInfo.categories);
    }
  }
  org.isFavorite = true;
  return org;
}


module.exports = {
  formatFavoritesEventResponse,
  formatFavoritesOrganization,
};
