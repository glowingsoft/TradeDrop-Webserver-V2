const express = require("express");
const {
  getNotificationPreferences,
  upsertNotificationPreferences,
} = require("../controllers/notificationPreferencesController");
const auth = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(auth);

// Route to get notification preferences
router.get("/", getNotificationPreferences);
// Route to update notification preferences
router.put("/", upsertNotificationPreferences);

module.exports = router;
