/**
 * TradeDrop route auth.
 * - AUTH_REPOSITORY=mongo → existing boiler plate authMiddleware (JWT + User)
 * - AUTH_REPOSITORY=memory → TF memory/repo auth (tests)
 * - requireVerifiedOnboarded → email verified + onboarding (gates Drop/Tap-in/Trade writes)
 */
const { sendResponse } = require("../../../helperUtils/responseUtil");
const { useMongoRepository } = require("../_shared/repoMode");
const boilerAuth = require("../../../middlewares/authMiddleware");
const memoryAuth = require("./memoryAuthMiddleware");
const authRepo = require("./authRepository");

function authenticate(req, res, next) {
  if (useMongoRepository()) {
    return boilerAuth(req, res, next);
  }
  return memoryAuth(req, res, next);
}

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
