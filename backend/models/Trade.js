const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

const sideSchema = new mongoose.Schema(
  {
    doneAt: { type: Date, default: null },
    proof: { type: String, default: "" },
  },
  { _id: false },
);

const tradeSchema = new mongoose.Schema(
  {
    tapInId: { type: ObjectId, ref: "TapIn", required: true, unique: true },
    dropId: { type: ObjectId, ref: "Drop", required: true, index: true },
    dropOwnerId: { type: ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["drop", "proposal", "collaboration"], required: true },
    requesterId: { type: ObjectId, ref: "User", required: true, index: true },
    responderId: { type: ObjectId, ref: "User", required: true, index: true },
    requester: { type: sideSchema, default: () => ({}) },
    responder: { type: sideSchema, default: () => ({}) },
    status: { type: String, enum: ["active", "completed", "cancelled"], default: "active", index: true },
    disputeId: { type: ObjectId, ref: "Dispute", default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Trade || mongoose.model("Trade", tradeSchema);
