const mongoose = require("mongoose");

const reportHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "under_review", "action_taken", "dismissed", "resolved"],
      required: true,
    },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: "", trim: true },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userReportSchema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: {
      type: String,
      enum: ["harassment", "spam", "inappropriate_content", "impersonation", "scams_fraud", "other"],
      required: true,
    },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    resourceType: { type: String, enum: ["user", "drop", "message", "circle", "event"], default: "user" },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    blockUser: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["pending", "under_review", "action_taken", "dismissed", "resolved"],
      default: "pending",
      index: true,
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolutionNote: { type: String, default: "", trim: true },
    history: { type: [reportHistorySchema], default: [] },
    outcomeNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userReportSchema.index({ status: 1, createdAt: 1 });
userReportSchema.index({ reporterId: 1, createdAt: -1 });
userReportSchema.index({ reportedUserId: 1, createdAt: -1 });
userReportSchema.index({ resourceType: 1, resourceId: 1 });

module.exports = mongoose.models.UserReport || mongoose.model("UserReport", userReportSchema);
