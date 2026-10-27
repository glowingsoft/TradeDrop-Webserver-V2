const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["member", "organizer"], default: "member" },
    status: { type: String, enum: ["active", "pending", "invited", "declined", "left"], default: "active" },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    joinedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const pollSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    options: {
      type: [{ type: String, trim: true, maxlength: 120 }],
      validate: (options) => options.length >= 2 && options.length <= 8,
      required: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    closesAt: { type: Date, required: true },
    status: { type: String, enum: ["active", "closed"], default: "active" },
    votes: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        optionIndex: { type: Number, required: true },
        votedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { _id: false },
);

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
    members: { type: [memberSchema], default: [] },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
    poll: { type: pollSchema, default: null },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

circleSchema.index({ location: "2dsphere" });
circleSchema.index({ privacy: 1, deletedAt: 1, city: 1, createdAt: -1 });
circleSchema.index({ "members.userId": 1, "members.status": 1 });
circleSchema.index({ "members.userId": 1, "members.role": 1 });
circleSchema.index({ "poll.status": 1, "poll.closesAt": 1 });

module.exports = mongoose.models.Circle || mongoose.model("Circle", circleSchema);
