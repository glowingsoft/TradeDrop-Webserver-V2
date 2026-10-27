const { sendResponse } = require("@helperUtils/responseUtil");
const { User } = require("@UsersModel");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server",
    data: error.data,
    error,
  });
}

const actorOf = (req) => ({
  _id: req.user._id,
  isAdmin: req.user.isAdmin === true || req.user.userType === "admin" || req.user.accountState?.userType === "admin",
});

// Wraps a service call that returns a single payload
const one = (statusCode, translationKey, call) => async (req, res) => {
  try {
    const data = await call(req);
    return sendResponse({ res, statusCode, translationKey, data });
  } catch (error) {
    return handleError(res, error);
  }
};

// Wraps a service call that returns { data, meta }
const list = (translationKey, call) => async (req, res) => {
  try {
    const { data, meta } = await call(req);
    return sendResponse({ res, statusCode: 200, translationKey, data, meta });
  } catch (error) {
    return handleError(res, error);
  }
};

// Runs after authMiddleware: email verified + onboarding complete
async function requireVerifiedOnboarded(req, res, next) {
  try {
    const user = await User.findById(req.user?._id).select("verificationStatus onboarding deletedAt").lean();
    if (!user || user.deletedAt) return sendResponse({ res, statusCode: 401, translationKey: "account_not_found" });
    if (user.verificationStatus?.email !== "verified") {
      return sendResponse({ res, statusCode: 403, translationKey: "email_unverified" });
    }
    if (!user.onboarding) return sendResponse({ res, statusCode: 403, translationKey: "onboarding_incomplete" });
    return next();
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { handleError, actorOf, one, list, requireVerifiedOnboarded };
