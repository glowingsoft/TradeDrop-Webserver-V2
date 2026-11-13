const mongoose = require("mongoose");

const circlePollVoteSchema = new mongoose.Schema({
  circleId: { type: mongoose.Schema.Types.ObjectId, ref: "Circle", required: true },
  pollId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  optionIndex: { type: Number, required: true, min: 0 },
  votedAt: { type: Date, default: Date.now },
});

circlePollVoteSchema.index({ circleId: 1, pollId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.CirclePollVote || mongoose.model("CirclePollVote", circlePollVoteSchema);
