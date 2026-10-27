const mongoose = require("mongoose");

// Define the NotificationTypes enum
const NotificationTypes = {
  BOOKING_REQUEST: "booking_request",
  NEW_BOOKING: "new_booking",
  BOOKING_CONFIRMATION: "booking_confirmation",
  BOOKING_REJECTION: "booking_rejection",
  BOOKING_CANCELLATION: "booking_cancellation",
  PAYMENT_COMPLETED: "payment_completed",
  BOOKING_REMINDER: "booking_reminder",
  PAYMENT_REMINDER: "payment_reminder",
  SESSION_REMINDER: "session_reminder",
  REVIEW_REMINDER: "review_reminder",
  GENERAL: "general",
  NEW_MESSAGE: "new_message",
  CONNECTION_REQUEST: "connection_request",
  TAP_IN: "tap_in",
  COLLABORATION: "collaboration",
  DISPUTE: "dispute",
  CIRCLE_INVITATION: "circle_invitation",
  EVENT: "event",
  STATUS_CHANGE: "status_change",
  SUPPORT_REQUEST: "support_request",
  INCOMING_CALL: "incoming_call",
  BOOKING: "booking",
  ANNOUNCEMENT: "announcement",
};

// Define the NotificationSchema
const NotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(NotificationTypes), // Reference the notification types enum
    required: true,
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference to the sender (optional)
    default: null,
  },
  objectId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  objectType: {
    type: String,
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference to the user for whom this notification is intended
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  body: {
    type: String,
    required: true,
  },
  // flexible metadata
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  image: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Automatically update `updatedAt` field on modification
NotificationSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Export both Notification model and NotificationTypes enum
const NotificationExp = mongoose.model("Notification", NotificationSchema);
module.exports = {
  NotificationExp,
};
module.exports.NotificationTypes = NotificationTypes;
