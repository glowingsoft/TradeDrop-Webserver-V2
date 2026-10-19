/**
 * TradeDrop route auth: JWT via the shared authMiddleware.
 * requireVerifiedOnboarded: email verified + onboarding complete.
 */
const { sendResponse } = require("../../../helperUtils/responseUtil");
const boilerAuth = require("../../../middlewares/authMiddleware");
const authRepo = require("./authRepository");

const authenticate = boilerAuth;

function optionalAuth(req, res, next) {
  const header = req.header("Authorization");
  if (!header) return next();
  return authenticate(req, res, next);
}

/**
 * Must run after authenticate. Enforces verified email + onboardingComplete.
 */
async function requireVerifiedOnboarded(req, res, next) {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "auth_header_missing",
      });
    }

    const user = await Promise.resolve(authRepo.findById(userId));
    if (!user || user.deletedAt) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "account_not_found",
      });
    }

    if (user.verificationStatus?.email !== "verified") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "email_unverified",
      });
    }

    if (!user.onboarding) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "onboarding_incomplete",
      });
    }

    // Full TF user for handlers that need handle / crafts / etc.
    req.tfUser = user;
    next();
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error,
    });
  }
}

module.exports = {
  authenticate,
  optionalAuth,
  requireVerifiedOnboarded,
};
