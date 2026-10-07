const express = require("express");
const auth = require("../middlewares/authMiddleware");
const createRateLimiter = require("../helperUtils/rateLimiter");
const { blockUser, unblockUser, listBlockedUsers } = require("../controllers/blockedUsersController");

const router = express.Router();
const blockedUsersRateLimiter = createRateLimiter("blocked-users", 10, 50);

router.use(auth);
router.post("/", blockedUsersRateLimiter, blockUser);
router.get("/", blockedUsersRateLimiter, listBlockedUsers);
router.delete("/:userId", blockedUsersRateLimiter, unblockUser);

module.exports = router;
