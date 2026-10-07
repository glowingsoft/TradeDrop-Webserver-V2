const favoriteRepo = require("./favoriteRepository");
const Organizations = require("../../commonModules/organizations/Organization");
const Menus = require("../../commonModules/menuManagement/menu/Menus");
const { Events } = require("@EventsModel");
const { generateMeta } = require("../../../helperUtils/responseUtil");
const { formatFavoritesEventResponse, formatFavoritesOrganization } = require("./formatter/favoritesFormatter");

/**
 * Maps target types to their corresponding Mongoose models.
 * Helps auto-update meta.favoritesCount on correct collection.
 */
const MODEL_MAP = {
  menu: Menus,
  event: Events,
  organization: Organizations,
};

/**
 * Toggle favorite for a user and target.
 * Automatically updates `meta.favoritesCount` in the target document.
 */
const toggleFavorite = async (userId, targetId, targetType) => {
  const result = await favoriteRepo.toggleFavorite(userId, targetId, targetType);
  const count = await favoriteRepo.countFavorites({ targetType });
  // Update meta.favoritesCount in the appropriate model
  const Model = MODEL_MAP[targetType];
  if (Model) {
    await Model.updateOne({ _id: targetId }, { "meta.favoritesCount": count });
  }

  return {
    isFavorited: result.isFavorited,
  };
};

/**
 * Check if a user has favorited a given target
 */
const isFavorited = async (userId, targetId, targetType) => {
  return await favoriteRepo.isFavorited(userId, targetId, targetType);
};

/**
 * Count total favorites for a target
 */
const getFavoriteCount = async (targetId, targetType) => {
  return await favoriteRepo.countFavorites({ targetId, targetType });
};

/**
 * Get a paginated list of user's favorites
 */
const getUserFavorites = async ({ userId, location, timezone, targetType, page = 1, limit = 20 }) => {
  let favorites, counts;

  if (targetType) {
    // Single targetType: get favorites and count as before
    [favorites, counts] = await Promise.all([
      favoriteRepo.getUserFavorites(
        userId,
        targetType,
        page,
        limit
      ),
      favoriteRepo.countFavorites({ user: userId, targetType }),
    ]);

    favorites = favorites?.map((fav) => {
      let formattedObject;
      if (fav.targetType === 'organization') {
        formattedObject = formatFavoritesOrganization(fav.object);
      } else if (fav.targetType === 'event') {
        formattedObject = formatFavoritesEventResponse(fav.object, { userLocation: location, timezone });
      } else if (fav.targetType === 'menu') {
        formattedObject = fav.object; // Add menu formatting if needed
      } else {
        formattedObject = fav.object;
      }
      return {
        ...fav.toObject?.() || fav,
        object: formattedObject,
      };
    });
  } else {
    // No targetType: get both events and organizations, each with their own limit
    const [events, organizations] = await Promise.all([
      favoriteRepo.getUserFavorites(userId, 'event', page, 10),
      favoriteRepo.getUserFavorites(userId, 'organization', page, 10),
    ]);
    const [eventCount, orgCount] = await Promise.all([
      favoriteRepo.countFavorites({ user: userId, targetType: 'event' }),
      favoriteRepo.countFavorites({ user: userId, targetType: 'organization' }),
    ]);

    favorites = {
      events: events?.map((fav) => ({
        ...fav.toObject?.() || fav,
        object: formatFavoritesEventResponse(fav.object, { userLocation: location, timezone }),
      })),
      organizations: organizations?.map((fav) => ({
        ...fav.toObject?.() || fav,
        object: formatFavoritesOrganization(fav.object),
      })),
    };
    counts = {
      events: eventCount,
      organizations: orgCount,
    };
  }


  const meta = generateMeta(page, limit, counts);

  return { favorites, meta };
};

/**
 * Remove all favorites for a deleted user or target (cleanup utility)
 */
const removeFavoritesByFilter = async (filter) => {
  return await favoriteRepo.deleteMany(filter);
};

module.exports = {
  toggleFavorite,
  isFavorited,
  getFavoriteCount,
  getUserFavorites,
  removeFavoritesByFilter,
};
