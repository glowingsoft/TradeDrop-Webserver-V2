const jwt = require("jsonwebtoken");
const { User } = require("../models/UserModel");
const { sendResponse } = require("../helperUtils/responseUtil");
const { i18nConfig } = require("../config/i18nConfig");
const { userCache } = require("../config/nodeCache");

const hasField = (obj, path) => {
  return path.split(".").reduce((o, key) => (o ? o[key] : undefined), obj) !== undefined;
};

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "auth_header_missing",
      });
    }

    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "auth_token_missing",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded._id;

    // Retrieve user from cache if available
    let user = userCache.get(userId);

    // Check if the user object is missing required fields
    const requiredFields = ["name", "profileIcon", "timezone", "language", "location", "userType", "accountState"];

    const isMissingRequiredFields = !user || requiredFields.some((field) => !hasField(user, field));

    if (!user || isMissingRequiredFields) {
      const selectFields = "name profileIcon email timezone language lat lng location accountState createdAt";
      user = await User.findById(userId).select(selectFields);

      if (!user) {
        return sendResponse({
          res,
          statusCode: 401,
          translationKey: "account_not_found",
        });
      }

      if (user.accountState.status === "restricted" || user.accountState.status === "suspended") {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "your_account_2",
        });
      }

      // Immediately convert user to a plain object for modification
      user = user.toObject();
      user.userType = user.accountState.userType;
      delete user.accountState;

      // Update the cache with the modified user object
      userCache.set(userId, user);
    }

    // Set the locale based on user's language
    i18nConfig.setLocale(req, user.language || "en");
    req.token = token;
    req.user = user;

    // Override timezone with client-sent header if provided
    const clientTimezone = req.header("X-Timezone");
    if (clientTimezone) {
      req.user = { ...req.user, timezone: clientTimezone };
    }

    next(); // Move to the next middleware/route handler
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 401,
      translationKey: "invalid_token",
      error: error,
    });
  }
};

module.exports = auth;
