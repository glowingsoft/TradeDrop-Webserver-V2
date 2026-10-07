const mongoose = require("mongoose");

const connectionSchema = new mongoose.Schema(
  {
    // user1 is always the lexicographically smaller ObjectId so a given pair maps to exactly one document
    user1: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    user2: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["active", "blocked", "removed"], default: "active" },
    source: {
      type: { type: String, enum: ["tapIn"], default: "tapIn" },
      tapInId: { type: mongoose.Schema.Types.ObjectId, ref: "TapIn", default: null },
    },
  },
  { timestamps: true },
);

// One connection document per unordered user pair — prevents duplicate connections
connectionSchema.index({ user1: 1, user2: 1 }, { unique: true });
connectionSchema.index({ user1: 1, status: 1 });
connectionSchema.index({ user2: 1, status: 1 });

connectionSchema.statics.normalizePair = function normalizePair(userA, userB) {
  const a = String(userA);
  const b = String(userB);
  return a < b ? [a, b] : [b, a];
};

module.exports = mongoose.models.Connection || mongoose.model("Connection", connectionSchema);
