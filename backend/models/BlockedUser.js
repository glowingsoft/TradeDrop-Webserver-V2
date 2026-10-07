const mongoose = require("mongoose");

const blockedUserSchema = new mongoose.Schema(
  {
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    blockedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Prevent duplicate blocks of the same user by the same blocker
blockedUserSchema.index({ blockedBy: 1, blockedUser: 1 }, { unique: true });
blockedUserSchema.index({ blockedUser: 1 });

module.exports = mongoose.models.BlockedUser || mongoose.model("BlockedUser", blockedUserSchema);
