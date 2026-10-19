const express = require("express");
const {
  createUser,
  getUsers,
  updateUser,
  deleteUser,
  getUserDetails,
  setupTwoFAController,
  confirmTwoFAController,
  disableTwoFAController,
  getAllUsers,
  getAllAthletes,
  getUserReviews,
} = require("./usersController");
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");
const { getUserBadges, awardUserBadge, revokeUserBadge } = require("../badges/badgesController");

const router = express.Router();

router.use(auth);

// Create a rate limiter for Users
const apiRateLimiterUsers = createRateLimiter("/users");
const apiRateLimiterUserDetail = createRateLimiter("/users/details");
const apiRateLimiterUserCreation = createRateLimiter("/users/create");
const apiRateLimiterUserUpdate = createRateLimiter("/users/update");
const apiRateLimiterUserDeletion = createRateLimiter("/users/delete");
const apiRateLimiterUserTwoFA = createRateLimiter("/users/twofa/setup", 3, 10); // 3 requests per 10 minutes
const apiRateLimiterTwoFAConfirm = createRateLimiter("/users/twofa/confirm", 5, 10); // 5 requests per 10 minutes
const apiRateLimiterTwoFADisable = createRateLimiter("/users/twofa/disable", 2, 30); // 2 requests per 30 minutes

// Create a new user
router.post("/", roleMiddleware(["admin"]), apiRateLimiterUserCreation, createUser);
router.get("/reviews", apiRateLimiterUsers, roleMiddleware(["admin"]), getUserReviews);
// Get user profile
router.get("/:id", apiRateLimiterUserDetail, getUserDetails);
// Get all users with pagination
router.get("/", apiRateLimiterUsers, roleMiddleware(["admin"]), getUsers);
// Update an existing user
router.put("/:id", apiRateLimiterUserUpdate, roleMiddleware(["admin"]), updateUser);

// Start 2FA setup (get QR code)
router.post("/twofa/setup", apiRateLimiterUserTwoFA, roleMiddleware(["admin"]), setupTwoFAController);

// Confirm 2FA (verify token)
router.post("/twofa/confirm", apiRateLimiterTwoFAConfirm, roleMiddleware(["admin"]), confirmTwoFAController);

// Disable 2FA
router.post("/twofa/disable", apiRateLimiterTwoFADisable, roleMiddleware(["admin"]), disableTwoFAController);

// Delete a user
router.delete("/:id", apiRateLimiterUserDeletion, roleMiddleware(["admin"]), deleteUser);
// Badges linked to a user
router.get("/:userId/badges", roleMiddleware(["admin"]), getUserBadges);
router.post("/:userId/badges/:badgeId", roleMiddleware(["admin"]), awardUserBadge);
router.delete("/:userId/badges/:badgeId", roleMiddleware(["admin"]), revokeUserBadge);

module.exports = router;
