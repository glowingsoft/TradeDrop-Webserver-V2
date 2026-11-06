const mongoose = require("mongoose");

const connectionRequestSchema = new mongoose.Schema(
  {
    pairKey: { type: String, required: true },
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "withdrawn", "cancelled"],
      default: "pending",
      index: true,
    },
    respondedAt: { type: Date, default: null },
    cooldownUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

connectionRequestSchema.index(
  { pairKey: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);
connectionRequestSchema.index({ recipientId: 1, status: 1, createdAt: -1 });
connectionRequestSchema.index({ requesterId: 1, status: 1, createdAt: -1 });
connectionRequestSchema.index({ pairKey: 1, cooldownUntil: -1 });

module.exports = mongoose.models.ConnectionRequest || mongoose.model("ConnectionRequest", connectionRequestSchema);
