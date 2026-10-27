const mongoose = require("mongoose");

const rsvpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["going", "pending", "waitlist", "cancelled"], default: "pending" },
    showToParticipants: { type: Boolean, default: false },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    circleId: { type: mongoose.Schema.Types.ObjectId, ref: "Circle", required: true, index: true },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    suggestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    purpose: { type: String, default: "", trim: true, maxlength: 5000 },
    date: { type: Date, default: null },
    time: { type: String, default: "" },
    publicArea: { type: String, default: "", trim: true },
    exactMeetingPoint: { type: String, default: "", trim: true },
    location: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: {
        type: [Number],
        default: undefined,
        validate: (coordinates) => coordinates.length === 2,
      },
    },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    audience: { type: String, enum: ["public", "member_only"], default: "member_only" },
    joining: { type: String, enum: ["immediate", "approval"], default: "immediate" },
    capacity: { type: Number, min: 1, default: null },
    locationLabel: { type: String, default: "", trim: true },
    status: { type: String, enum: ["draft", "published", "cancelled"], default: "draft", index: true },
    suggestionStatus: { type: String, enum: ["pending", "approved", "declined", null], default: null },
    rsvps: { type: [rsvpSchema], default: [] },
    publishedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

eventSchema.index({ location: "2dsphere" });
eventSchema.index({ circleId: 1, status: 1, date: 1 });
eventSchema.index({ audience: 1, status: 1, date: 1 });
eventSchema.index({ "rsvps.userId": 1, "rsvps.status": 1 });

module.exports = mongoose.models.Event || mongoose.model("Event", eventSchema);
