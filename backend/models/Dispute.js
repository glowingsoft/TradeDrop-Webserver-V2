const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

const disputeSchema = new mongoose.Schema(
  {
    tradeId: { type: ObjectId, ref: "Trade", required: true, index: true },
    raisedBy: { type: ObjectId, ref: "User", required: true, index: true },
    against: { type: ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, enum: ["not_fulfilled", "fraud", "other"], required: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", index: true },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    evidence: { type: [String], default: [] },
    response: { type: String, default: "", trim: true, maxlength: 2000 },
    responseEvidence: { type: [String], default: [] },
    respondedAt: { type: Date, default: null },
    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    outcome: { type: String, enum: ["complete", "cancel", "dismissed", null], default: null },
    faultUserId: { type: ObjectId, ref: "User", default: null },
    resolvedBy: { type: ObjectId, ref: "User", default: null },
    resolutionType: { type: String, enum: ["admin", "mutual", null], default: null },
    resolutionNote: { type: String, default: "" },
    internalNote: { type: String, default: "", trim: true, maxlength: 2000 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One open dispute per trade
disputeSchema.index({ tradeId: 1 }, { unique: true, partialFilterExpression: { status: "open" } });

module.exports = {
  Dispute: mongoose.models.Dispute || mongoose.model("Dispute", disputeSchema),
};
