const mongoose = require("mongoose");
const dropSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["need", "offer"],
      default: "need",
      required: true,
    },
    ownerHandle: { type: String, default: "" },
    needText: { type: String, required: true },
    offerText: { type: String, required: true },
    needCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    offerCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    timingChip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimingChip",
      required: true,
    },
    date: { type: Date, default: null },
    areaLabel: { type: String, required: true },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    location: { type: [Number], default: undefined },
    detail: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "inprogress", "paused", "completed", "expired", "deleted"],
      default: "active",
      index: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

dropSchema.index({ status: 1, createdAt: -1 });
dropSchema.index({ ownerId: 1, status: 1 });
dropSchema.index({ areaLabel: 1 });
dropSchema.index({ location: "2dsphere" });

module.exports = {
  Drop: mongoose.models.Drop || mongoose.model("Drop", dropSchema),
};
