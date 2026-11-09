const {
  sendResponse,
  parsePaginationParams,
  validateParams,
  generateMeta,
  getReadableErrorMessage,
} = require("../../../helperUtils/responseUtil");
const { getFullImageUrl } = require("../../../helperUtils/imageHelper");
const { Favorites } = require("../../../commonModules/favorites/Favorite");
const { User } = require("@UsersModel");
const Category = require("../../../models/Category");

const fail = (res, error) => {
  const { statusCode, message } = getReadableErrorMessage(error);
  return sendResponse({ res, statusCode, translationKey: message, error });
};

/**
 * @route POST /api/v1/favorites/toggle
 * @desc Favorite / unfavorite a user
 */
const toggleFavorite = async (req, res) => {
  if (!validateParams(req, res, { rawData: ["targetId"], objectIdFields: ["targetId"] })) return;

  const userId = req.user._id;
  const { targetId } = req.body;

  try {
    if (String(userId) === String(targetId)) {
      return sendResponse({ res, statusCode: 400, translationKey: "cannot_favorite_yourself" });
    }
    if (!(await User.exists({ _id: targetId }))) {
      return sendResponse({ res, statusCode: 404, translationKey: "user_not_found" });
    }

    const { deletedCount } = await Favorites.deleteOne({ user: userId, target: targetId });
    const isFavorited = !deletedCount;
    if (isFavorited) {
      // upsert keeps concurrent taps from creating duplicates
      await Favorites.updateOne({ user: userId, target: targetId }, {}, { upsert: true });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: isFavorited ? "added_to_favorites_successfully" : "removed_from_favorites_successfully",
      data: { isFavorited },
    });
  } catch (error) {
    return fail(res, error);
  }
};

/**
 * @route GET /api/v1/favorites
 * @desc Paginated list of favorited users, including crafts with full image URLs
 */
const getUserFavorites = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const filter = { user: req.user._id };

  try {
    const [items, total] = await Promise.all([
      Favorites.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: "target",
          select: "name handle profileIcon crafts",
          populate: { path: "crafts", model: Category, select: "name image" },
        })
        .lean(),
      Favorites.countDocuments(filter),
    ]);

    const data = items
      .filter((f) => f.target)
      .map(({ target, createdAt }) => ({
        _id: target._id,
        name: target.name,
        handle: target.handle,
        profileIcon: getFullImageUrl(target.profileIcon) || null,
        crafts: (target.crafts || []).filter(Boolean).map((craft) => ({
          _id: craft._id,
          name: craft.name,
          image: getFullImageUrl(craft.image),
        })),
        favoritedAt: createdAt,
      }));

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "favorites_fetched_successfully",
      data,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return fail(res, error);
  }
};

/**
 * @route GET /api/v1/favorites/:targetId/status
 * @desc Whether the logged-in user has favorited the given user
 */
const isFavorited = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["targetId"], objectIdFields: ["targetId"] })) return;

  try {
    const favorited = !!(await Favorites.exists({ user: req.user._id, target: req.params.targetId }));
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: favorited ? "user_has_favorited" : "user_has_not_favorited",
      data: { favorited },
    });
  } catch (error) {
    return fail(res, error);
  }
};

module.exports = { toggleFavorite, getUserFavorites, isFavorited };
