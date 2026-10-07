const mongoose = require("mongoose");

const messageRequestSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, default: "", trim: true, maxlength: 500 },
    status: { type: String, enum: ["pending", "accepted", "rejected", "blocked"], default: "pending" },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Only one pending request per (sender, receiver) pair at a time — prevents duplicate spam
messageRequestSchema.index(
  { sender: 1, receiver: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);
messageRequestSchema.index({ receiver: 1, status: 1 });
messageRequestSchema.index({ sender: 1, status: 1 });

module.exports = mongoose.models.MessageRequest || mongoose.model("MessageRequest", messageRequestSchema);
