const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    tapInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TapIn",
      default: null,
      index: true,
    },
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stars: { type: Number, required: true, min: 1, max: 5 },
    body: { type: String, default: "" },
    fromUserDeleted: { type: Boolean, default: false },
    toUserDeleted: { type: Boolean, default: false },
    fromHandle: { type: String, default: "" },
    toHandle: { type: String, default: "" },
  },
  { timestamps: true },
);

// reviewSchema.index({ tradeId: 1, fromUserId: 1 }, { unique: true, sparse: true });
reviewSchema.index({ tapInId: 1, fromUserId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
