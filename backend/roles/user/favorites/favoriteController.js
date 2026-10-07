const {
    sendResponse,
    parsePaginationParams,
    validateParams,
    getReadableErrorMessage,
} = require("../../../helperUtils/responseUtil");
const { FavoriteTargetTypes } = require("../../../commonModules/favorites/Favorite");

const favoriteService = require("./favoriteService");

/**
 * @desc Toggle favorite (add/remove)
 * @route POST /api/v1/favorites/toggle
 * @access Authenticated users
 */
const toggleFavorite = async (req, res) => {
    const { targetId, targetType } = req.body;
    const userId = req.user._id;

    if (
        !validateParams(req, res, {
            rawData: ["targetId", "targetType"],
            objectIdFields: ["targetId"],
            enumFields: {
                targetType: FavoriteTargetTypes,
            },
        })
    )
        return;

    try {
        const result = await favoriteService.toggleFavorite(userId, targetId, targetType);

        let translationKey = "";
        if (result.isFavorited) {
            translationKey = "added_to_favorites_successfully";
        } else {
            translationKey = "removed_from_favorites_successfully";
        }
        return sendResponse({
            res,
            statusCode: 200,
            translationKey,
            data: result,
        });
    } catch (error) {
        const readableError = getReadableErrorMessage(error);
        return sendResponse({
            res,
            statusCode: readableError.statusCode,
            translationKey: readableError.message,
            error,
        });
    }
};

/**
 * @desc Get user favorites (paginated)
 * @route GET /api/v1/favorites/user
 * @access Authenticated users
 */
const getUserFavorites = async (req, res) => {
    const { page, limit } = parsePaginationParams(req);
    const { targetType } = req.query;
    const { _id: userId, location, timezone } = req.user;

    try {
        if (
            targetType &&
            !validateParams(req, res, {
                enumFields: {
                    targetType: FavoriteTargetTypes,
                },
            })
        )
            return;

        const { favorites, meta } = await favoriteService.getUserFavorites({
            userId,
            location,
            timezone,
            targetType,
            page,
            limit,
        });

        return sendResponse({
            res,
            statusCode: 200,
            translationKey: "favorites_fetched_successfully",
            data: favorites,
            meta,
        });
    } catch (error) {
        const readableError = getReadableErrorMessage(error);
        return sendResponse({
            res,
            statusCode: readableError.statusCode,
            translationKey: readableError.message,
            error,
        });
    }
};

/**
 * @desc Check if user has favorited target
 * @route GET /api/v1/favorites/:targetType/:targetId/status
 * @access Authenticated users
 */
const isFavorited = async (req, res) => {
    const { targetType, targetId } = req.params;
    const userId = req.user._id;

    if (
        !validateParams(req, res, {
            pathParams: ["targetType", "targetId"],
            objectIdFields: ["targetId"],
            enumFields: {
                targetType: ["menu", "trainer", "session", "category"],
            },
        })
    )
        return;

    try {
        const favorited = await favoriteService.isFavorited(userId, targetId, targetType);

        return sendResponse({
            res,
            statusCode: 200,
            translationKey: favorited
                ? "user_has_favorited"
                : "user_has_not_favorited",
            data: { favorited },
        });
    } catch (error) {
        const readableError = getReadableErrorMessage(error);
        return sendResponse({
            res,
            statusCode: readableError.statusCode,
            translationKey: readableError.message,
            error,
        });
    }
};

module.exports = {
    toggleFavorite,
    getUserFavorites,
    isFavorited,
};
