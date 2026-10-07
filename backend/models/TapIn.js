const mongoose = require("mongoose");

const tapInSchema = new mongoose.Schema(
  {
    dropId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Drop",
      required: true,
      index: true,
    },
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    applicantHandle: { type: String, default: "" },
    ownerHandle: { type: String, default: "" },
    yourOffer: { type: String, required: true },
    availability: { type: String, required: true },
    link: { type: String, default: "" },
    note: { type: String, default: "" },
    media: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "inprogress", "declined", "withdrawn", "deleted", "completed"],
      default: "pending",
    },
    ownerJob: {
      status: {
        type: String,
        enum: ["pending", "inprogress", "completion_requested", "completed"],
        default: "pending",
      },
      completionImgUrl: { type: String, default: "" },
      completedAt: Date,
    },
    applicantJob: {
      status: {
        type: String,
        enum: ["pending", "inprogress", "completion_requested", "completed"],
        default: "pending",
      },
      completionImgUrl: { type: String, default: "" },
      completedAt: Date,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One pending tap-in per (applicant, drop)
tapInSchema.index(
  { applicantId: 1, dropId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

module.exports = mongoose.models.TapIn || mongoose.model("TapIn", tapInSchema);
