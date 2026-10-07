const { sendResponse, validateParams } = require("../../../helperUtils/responseUtil");
const badgesService = require("./badgesService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const createBadge = async (req, res) => {
  try {
    const badge = await badgesService.createBadge(req.body, req.user?._id);
    return sendResponse({ res, statusCode: 201, translationKey: "badge_created", data: badge });
  } catch (error) {
    return handleError(res, error);
  }
};

const getBadges = async (req, res) => {
  try {
    const badges = await badgesService.listBadges({ req });
    return sendResponse({ res, statusCode: 200, translationKey: "badges_fetched", data: badges });
  } catch (error) {
    return handleError(res, error);
  }
};

const getBadgeById = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const badge = await badgesService.getBadgeById(req.params.id);
    return sendResponse({ res, statusCode: 200, translationKey: "badge_fetched", data: badge });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateBadge = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const badge = await badgesService.updateBadge(req.params.id, req.body, req.user?._id);
    return sendResponse({ res, statusCode: 200, translationKey: "badge_updated", data: badge });
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteBadge = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    await badgesService.deleteBadge(req.params.id);
    return sendResponse({ res, statusCode: 200, translationKey: "badge_deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

const getUserBadges = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["userId"], objectIdFields: ["userId"] })) return;
  try {
    const badges = await badgesService.listUserBadges(req.params.userId);
    return sendResponse({ res, statusCode: 200, translationKey: "user_badges_fetched", data: badges });
  } catch (error) {
    return handleError(res, error);
  }
};

const awardUserBadge = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["userId", "badgeId"], objectIdFields: ["userId", "badgeId"] })) return;
  try {
    const userBadge = await badgesService.awardBadgeToUser(req.params.userId, req.params.badgeId, req.user?._id);
    return sendResponse({ res, statusCode: 201, translationKey: "badge_awarded", data: userBadge });
  } catch (error) {
    return handleError(res, error);
  }
};

const revokeUserBadge = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["userId", "badgeId"], objectIdFields: ["userId", "badgeId"] })) return;
  try {
    await badgesService.revokeBadgeFromUser(req.params.userId, req.params.badgeId);
    return sendResponse({ res, statusCode: 200, translationKey: "badge_revoked" });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createBadge,
  getBadges,
  getBadgeById,
  updateBadge,
  deleteBadge,
  getUserBadges,
  awardUserBadge,
  revokeUserBadge,
};
