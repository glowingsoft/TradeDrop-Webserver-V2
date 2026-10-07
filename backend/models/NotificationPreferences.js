const mongoose = require("mongoose");

const notificationPreferencesSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // 1. Email Notifications (general updates via email)
    emailNotifications: {
      type: Boolean,
      default: true,
    },

    // 2. Push Notifications (device alerts)
    pushNotifications: {
      type: Boolean,
      default: true,
    },

    // 3. Profile View Alerts
    profileViewAlerts: {
      type: Boolean,
      default: true,
    },

    // 4. Message Alerts
    messageAlerts: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const NotificationPreferences = mongoose.model(
  "NotificationPreferences",
  notificationPreferencesSchema
);

module.exports = NotificationPreferences;