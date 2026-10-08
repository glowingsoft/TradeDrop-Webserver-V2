const mongoose = require("mongoose");

const dropSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerHandle: { type: String, default: "" },
    kind: { type: String, enum: ["drop", "proposal", "collaboration"], default: "drop", required: true },
    visibility: { type: String, enum: ["public", "direct"], default: "public", required: true },
    // Set for direct drops only
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    needText: { type: String, required: true },
    offerText: { type: String, required: true },
    needCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    offerCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    timingChip: { type: mongoose.Schema.Types.ObjectId, ref: "TimingChip", required: true },
    date: { type: Date, default: null },
    areaLabel: { type: String, required: true },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    location: { type: [Number], default: undefined },
    detail: { type: String, default: "" },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    deletedAt: { type: Date, default: null },
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
