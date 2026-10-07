const mongoose = require("mongoose");

const ACTIVITY_TYPES = Object.freeze({
  NEW_SIGNUP: "new_signup",
  NEW_DROP: "new_drop",
  DROP_COMPLETED: "drop_completed",
});

const ACTIVITY_ACTIONS = Object.freeze({
  [ACTIVITY_TYPES.NEW_SIGNUP]: "New Signup",
  [ACTIVITY_TYPES.NEW_DROP]: "New Drop",
  [ACTIVITY_TYPES.DROP_COMPLETED]: "Trade/Drop completed",
});

const NOTIFICATION_ACTIVITIES = [
  {
    label: "Active Last 7 Days",
    value: "active_last_7_days",
  },
  {
    label: "Inactive Last 30 Days",
    value: "inactive_last_30_days",
  },
  {
    label: "Last 7 New Signups",
    value: "last_7_new_signups",
  },
];

const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(ACTIVITY_TYPES),
      required: true,
      immutable: true,
    },

    // Human-readable label for the feed.
    action: {
      type: String,
      required: true,
      immutable: true,
    },

    // User who performed/caused the activity.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Related drop, if any.
    drop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Drop",
      default: null,
      index: true,
    },

    // Guarantees the same event isn't recorded twice.
    eventKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// User's activities.
activitySchema.index({
  user: 1,
  createdAt: -1,
  _id: -1,
});

const Activity = mongoose.model("Activity", activitySchema);

module.exports = {
  Activity,
  ACTIVITY_TYPES,
  ACTIVITY_ACTIONS,
  NOTIFICATION_ACTIVITIES,
};
