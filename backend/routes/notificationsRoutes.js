const express = require("express");
const auth = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const createRateLimiter = require("../helperUtils/rateLimiter");

const {
  getNotifications,
  readNotification,
  getAudienceSegments,
  sendNotificationBySegments,
} = require("../controllers/notificationsController");

const router = express.Router();
const notificationsRateLimiter = createRateLimiter("notifications", 10, 50);

// Route to get all notifications with pagination
router.get("/", notificationsRateLimiter, auth, getNotifications);
router.get("/segments", notificationsRateLimiter, auth, roleMiddleware(["admin"]), getAudienceSegments);
router.post("/send-by-segments", notificationsRateLimiter, auth, roleMiddleware(["admin"]), sendNotificationBySegments);

// Route to mark a notification as read by ID
router.put("/:id/read", notificationsRateLimiter, auth, readNotification);

module.exports = router;
