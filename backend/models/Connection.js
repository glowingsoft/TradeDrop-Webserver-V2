const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

const connectionSchema = new mongoose.Schema(
  {
    // Sorted "idA_idB" so an unordered pair maps to exactly one document
    pairKey: { type: String, required: true, unique: true },
    userA: { type: ObjectId, ref: "User", required: true },
    userB: { type: ObjectId, ref: "User", required: true },
    source: { type: String, default: "trade" },
    completedCount: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "blocked"], default: "active" },
  },
  { timestamps: true },
);

connectionSchema.index({ userA: 1, status: 1 });
connectionSchema.index({ userB: 1, status: 1 });

// Sorted [userA, userB] so the same pair always yields the same key
connectionSchema.statics.normalizePair = function normalizePair(x, y) {
  const a = String(x);
  const b = String(y);
  return a < b ? [a, b] : [b, a];
};

connectionSchema.statics.pairKeyFor = function pairKeyFor(x, y) {
  return this.normalizePair(x, y).join("_");
};

module.exports = mongoose.models.Connection || mongoose.model("Connection", connectionSchema);
