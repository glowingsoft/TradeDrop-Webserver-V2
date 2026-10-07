const express = require("express");
const {
  toggleFavorite,
  getUserFavorites,
  isFavorited,
} = require("../../app/favorites/favoriteController");
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const auth = require("../../../middlewares/authMiddleware");

const router = express.Router();

// ✅ Require authentication for all routes
router.use(auth);

// ✅ Create a rate limiter for Favorites
const apiRateLimiter = createRateLimiter("Favorites");

/**
 * @route POST /api/v1/favorites/toggle
 * @desc Add or remove a favorite (toggle)
 * @access Authenticated users
 */
router.post("/toggle", apiRateLimiter, toggleFavorite);

/**
 * @route GET /api/v1/favorites/user
 * @desc Get user's favorites (paginated)
 * @access Authenticated users
 */
router.get("/", apiRateLimiter, getUserFavorites);

/**
 * @route GET /api/v1/favorites/:targetType/:targetId/status
 * @desc Check if the logged-in user has favorited a specific item
 * @access Authenticated users
 */
router.get("/:targetType/:targetId/status", apiRateLimiter, isFavorited);

module.exports = router;
