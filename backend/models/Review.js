const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

const reviewSchema = new mongoose.Schema(
  {
    tradeId: { type: ObjectId, ref: "Trade", required: true, index: true },
    reviewerId: { type: ObjectId, ref: "User", required: true },
    revieweeId: { type: ObjectId, ref: "User", required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
  },
  { timestamps: true },
);

reviewSchema.index({ tradeId: 1, reviewerId: 1 }, { unique: true });

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
