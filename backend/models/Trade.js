const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema(
  {
    dropId: { type: mongoose.Schema.Types.ObjectId, ref: "Drop", required: true },
    tapInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TapIn",
      required: true,
      unique: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["in_progress", "completion_proposed", "completed", "cancelled"],
      default: "in_progress",
      index: true,
    },
    completionProposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completionProposedAt: { type: Date, default: null },
    completionPhotoUrl: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Trade || mongoose.model("Trade", tradeSchema);
