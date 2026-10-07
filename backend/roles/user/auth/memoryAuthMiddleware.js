const jwt = require("jsonwebtoken");
const { sendResponse } = require("../../../helperUtils/responseUtil");
const repo = require("./authRepository");

/**
 * JWT auth against in-memory TradeDrop user store (mock Slice 1).
 * Does not call Mongo.
 */
const memoryAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "auth_header_missing",
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "auth_token_missing",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await Promise.resolve(repo.findById(decoded._id));

    if (!user || user.deletedAt) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "account_not_found",
      });
    }

    if (user.accountState?.status === "restricted" || user.accountState?.status === "suspended") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "your_account_2",
      });
    }

    req.token = token;
    req.user = {
      _id: user._id,
      email: user.email,
      name: user.name,
      handle: user.handle,
      timezone: user.timezone,
      language: user.language,
      userType: user.accountState?.userType || "user",
      verificationStatus: user.verificationStatus,
      onboardingComplete: user.onboarding,
      accountState: user.accountState,
    };

    next();
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 401,
      translationKey: "invalid_token",
      error,
    });
  }
};

module.exports = memoryAuthMiddleware;
