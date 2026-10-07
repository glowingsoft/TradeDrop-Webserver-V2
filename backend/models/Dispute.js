const mongoose = require("mongoose");

const DISPUTE_STATUSES = ["pending", "under_review", "approved", "denied", "resolved"];

const disputeSchema = new mongoose.Schema(
  {
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedAgainst: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    drop: { type: mongoose.Schema.Types.ObjectId, ref: "Drop", default: null },
    tapIn: { type: mongoose.Schema.Types.ObjectId, ref: "TapIn", default: null },
    reason: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    evidence: { type: [String], default: [] },
    status: { type: String, enum: DISPUTE_STATUSES, default: "pending" },
    adminReview: {
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt: { type: Date, default: null },
      decision: { type: String, enum: ["approved", "denied", null], default: null },
      note: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

disputeSchema.index({ reportedBy: 1, createdAt: -1 });
disputeSchema.index({ reportedAgainst: 1 });
disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ drop: 1 });
disputeSchema.index({ tapIn: 1 });

module.exports = {
  Dispute: mongoose.models.Dispute || mongoose.model("Dispute", disputeSchema),
  DISPUTE_STATUSES,
};
