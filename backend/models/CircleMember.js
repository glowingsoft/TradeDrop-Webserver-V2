const mongoose = require("mongoose");

const circleMemberSchema = new mongoose.Schema(
  {
    circleId: { type: mongoose.Schema.Types.ObjectId, ref: "Circle", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["member", "organizer"], default: "member" },
    status: { type: String, enum: ["active", "pending", "invited", "declined", "left"], default: "active" },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    joinedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

circleMemberSchema.index({ circleId: 1, userId: 1 }, { unique: true });
circleMemberSchema.index({ circleId: 1, status: 1, role: 1 });
circleMemberSchema.index({ circleId: 1, status: 1, joinedAt: 1, _id: 1 });
circleMemberSchema.index({ userId: 1, status: 1, role: 1 });

module.exports = mongoose.models.CircleMember || mongoose.model("CircleMember", circleMemberSchema);
