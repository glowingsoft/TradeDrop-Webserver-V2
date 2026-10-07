const rateLimit = require("express-rate-limit");
const { sendResponse } = require("../helperUtils/responseUtil");
const RedisRateLimitStore = require("./redisRateLimitStore");

function normalizePrefix(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveRateLimitKey(req) {
  const userId = req.user?._id?.toString?.() || req.user?._id;
  if (userId) {
    return `user:${userId}`;
  }

  return `ip:${req.ip}`;
}

/**
 * Create a rate limiter middleware for Express routes.
 * @param {string} endpoint - The name of the endpoint (for logging purposes).
 * @param {number} [timeWindow=15] - The time window in minutes.
 * @param {number} [maxRequests=5] - The maximum number of requests allowed.
 * @param {Object} [options={}] - Extra express-rate-limit options.
 * @returns {Function} Express middleware function for rate limiting.
 */
function createRateLimiter(endpoint, timeWindow = 15, maxRequests = 200, options = {}) {
  const prefix = normalizePrefix(endpoint || "general");
  return rateLimit({
    windowMs: timeWindow * 60 * 1000,
    limit: 200 || maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    keyGenerator: resolveRateLimitKey,
    store: new RedisRateLimitStore({
      prefix: `rate-limit:${prefix}`,
    }),
    handler: (req, res) => {
      return sendResponse({
        res,
        statusCode: 429,
        translationKey: `Too many requests to ${endpoint}. Please try again later.`,
        error: {
          message: `Too many requests to ${endpoint}. Please try again later.`,
        },
      });
    },
    ...options,
  });
}

module.exports = createRateLimiter;
