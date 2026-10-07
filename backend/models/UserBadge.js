const mongoose = require("mongoose");

const userBadgeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    badge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Badge",
      required: true,
      index: true,
    },
    earnedAt: {
      type: Date,
      default: Date.now,
    },
    earnedReason: {
      type: String,
      trim: true,
      default: "",
    },
    awardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

userBadgeSchema.index({ user: 1, badge: 1 }, { unique: true });

const UserBadge = mongoose.models.UserBadge || mongoose.model("UserBadge", userBadgeSchema);

module.exports = { UserBadge };
