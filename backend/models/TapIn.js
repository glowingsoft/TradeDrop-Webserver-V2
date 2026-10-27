const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

// A request only. The work itself lives on the Trade created when this is accepted.
const tapInSchema = new mongoose.Schema(
  {
    dropId: { type: ObjectId, ref: "Drop", required: true, index: true },
    requesterId: { type: ObjectId, ref: "User", required: true, index: true },
    responderId: { type: ObjectId, ref: "User", required: true, index: true },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["pending", "accepted", "declined", "closed"], default: "pending" },
    tradeId: { type: ObjectId, ref: "Trade", default: null },
    closedAt: { type: Date, default: null },
    closureReason: { type: String, default: "" },
    // Set when the requester withdraws
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One live pending request per (requester, drop). Withdrawn requests (deletedAt set) are excluded.
tapInSchema.index(
  { requesterId: 1, dropId: 1 },
  { unique: true, partialFilterExpression: { status: "pending", deletedAt: { $type: "null" } } },
);
tapInSchema.index({ responderId: 1, status: 1, createdAt: -1 });
tapInSchema.index({ requesterId: 1, createdAt: -1 });

module.exports = mongoose.models.TapIn || mongoose.model("TapIn", tapInSchema);
