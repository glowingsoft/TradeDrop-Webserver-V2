const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema.Types;

const disputeSchema = new mongoose.Schema(
  {
    tradeId: { type: ObjectId, ref: "Trade", required: true },
    raisedBy: { type: ObjectId, ref: "User", required: true, index: true },
    against: { type: ObjectId, ref: "User", required: true, index: true },
    reason: {
      type: String,
      enum: [
        "work_not_delivered",
        "not_as_agreed",
        "quality_below_agreed",
        "stopped_responding",
        "late_no_update",
        "unsafe_behavior",
        "other",
        "not_fulfilled",
        "fraud",
      ],
      required: true,
    },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", index: true },
    description: { type: String, default: "", trim: true, minlength: 20, maxlength: 500 },
    evidence: { type: [String], default: [], validate: (items) => items.length <= 3 },
    desiredOutcome: {
      type: String,
      enum: ["finish_agreed_work", "redo_part", "agree_scope_first", "cancel", "need_reply"],
      required: true,
    },
    response: { type: String, default: "", trim: true, maxlength: 2000 },
    responseEvidence: { type: [String], default: [], validate: (items) => items.length <= 3 },
    respondedAt: { type: Date, default: null },
    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    stage: {
      type: String,
      enum: ["opened", "other_side_responded", "tradedrop_review", "resolved"],
      default: "opened",
    },
    outcome: {
      type: String,
      enum: [
        "finish_agreed_work",
        "redo_part",
        "agree_scope_first",
        "cancel",
        "need_reply",
        "complete",
        "dismissed",
        null,
      ],
      default: null,
    },
    resolvedByParticipants: {
      type: [
        {
          userId: { type: ObjectId, ref: "User", required: true },
          confirmedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    reviewRequestedAt: { type: Date, default: null },
    reviewRequestedBy: { type: ObjectId, ref: "User", default: null },
    escalatedAt: { type: Date, default: null },
    escalatedBy: { type: ObjectId, ref: "User", default: null },
    withdrawnAt: { type: Date, default: null },
    withdrawnBy: { type: ObjectId, ref: "User", default: null },
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
