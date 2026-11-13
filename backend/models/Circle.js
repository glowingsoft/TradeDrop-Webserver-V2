const mongoose = require("mongoose");

const pollSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 300 },
  options: {
    type: [{ type: String, trim: true, maxlength: 120 }],
    validate: (options) => options.length >= 2 && options.length <= 8,
    required: true,
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  closesAt: { type: Date, required: true },
  status: { type: String, enum: ["active", "closed"], default: "active" },
  voteVersion: { type: Number, default: 0 },
});

const circleSchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    purpose: { type: String, required: true, trim: true, maxlength: 2000 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    coverImage: { type: String, default: "" },
    city: { type: String, default: "", trim: true },
    privacy: { type: String, enum: ["open", "approval", "invite_only"], default: "open", index: true },
    location: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: {
        type: [Number],
        default: undefined,
        validate: (coordinates) => coordinates.length === 2,
      },
    },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
    polls: [pollSchema],
    status: { type: String, enum: ["active", "archived", "inactive"], default: "active" },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

circleSchema.index({ location: "2dsphere" });
circleSchema.index({ privacy: 1, deletedAt: 1, city: 1, createdAt: -1 });
circleSchema.index({ privacy: 1, deletedAt: 1, category: 1, createdAt: -1 });
circleSchema.index({ "polls._id": 1, "polls.status": 1, "polls.closesAt": 1 });

module.exports = mongoose.models.Circle || mongoose.model("Circle", circleSchema);
