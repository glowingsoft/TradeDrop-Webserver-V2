const express = require("express");
const auth = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const createRateLimiter = require("../helperUtils/rateLimiter");

const {
  getNotifications,
  readAllNotifications,
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

// Routes to mark notifications as read
router.put("/read-all", notificationsRateLimiter, auth, readAllNotifications);
router.put("/:id/read", notificationsRateLimiter, auth, readNotification);

module.exports = router;
