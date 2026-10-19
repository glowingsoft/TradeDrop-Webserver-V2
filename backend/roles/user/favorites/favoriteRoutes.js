const express = require("express");
const { toggleFavorite, getUserFavorites, isFavorited } = require("./favoriteController");
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const auth = require("../../../middlewares/authMiddleware");

const router = express.Router();
const apiRateLimiter = createRateLimiter("Favorites");

router.use(auth, apiRateLimiter);

router.post("/toggle", toggleFavorite); // favorite / unfavorite a user
router.get("/", getUserFavorites); // users I favorited (paginated)
router.get("/:targetId/status", isFavorited); // am I favoriting this user?

module.exports = router;
