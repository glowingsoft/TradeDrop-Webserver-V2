const mongoose = require("mongoose");

const dropSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerHandle: { type: String, default: "" },
    kind: { type: String, enum: ["drop", "proposal", "collaboration"], default: "drop", required: true },
    visibility: { type: String, enum: ["public", "direct"], default: "public", required: true },
    // Set for direct drops only
    title: {
      type: String,
      required: function () {
        return this.status !== "draft";
      },
      trim: true,
      default: "",
    },
    idea: { type: String, default: "", trim: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    needText: {
      type: String,
      required: function () {
        return this.status !== "draft";
      },
      default: "",
    },
    offerText: {
      type: String,
      required: function () {
        return this.status !== "draft";
      },
      default: "",
    },
    needCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: function () {
        return this.status !== "draft";
      },
    },
    offerCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: function () {
        return this.status !== "draft";
      },
    },
    timingChip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimingChip",
      default: null,
    },
    date: { type: Date, default: null },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    // Location
    locationType: {
      type: String,
      enum: ["neighborhood", "specific", "remote"],
      default: "neighborhood",
    },
    type: { type: String, enum: ["in_person", "remote"], default: "in_person" },
    areaLabel: {
      type: String,
      required: function () {
        return this.status !== "draft" && this.type !== "remote";
      },
      default: "",
    },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    location: { type: [Number], default: undefined },
    status: { type: String, enum: ["draft", "open", "closed", "expired"], default: "draft" },
    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    referenceImages: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

dropSchema.index({ visibility: 1, status: 1, deletedAt: 1, createdAt: -1 });
dropSchema.index({ ownerId: 1, status: 1 });
dropSchema.index({ targetUserId: 1 }, { sparse: true });
dropSchema.index({ areaLabel: 1 });
dropSchema.index({ location: "2dsphere" });

module.exports = {
  Drop: mongoose.models.Drop || mongoose.model("Drop", dropSchema),
};
