const mongoose = require("mongoose");

const BADGE_METRICS = ["completed_trades", "founding_member"];
const BADGE_OPERATORS = [">=", ">", "=", "<=", "<"];

const badgeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    icon: {
      type: String,
      trim: true,
      default: "noimg.png",
    },
    metric: {
      type: String,
      enum: BADGE_METRICS,
      required: true,
    },
    operator: {
      type: String,
      enum: BADGE_OPERATORS,
      required: true,
    },
    threshold: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

badgeSchema.index({ metric: 1, status: 1 });

const Badge = mongoose.models.Badge || mongoose.model("Badge", badgeSchema);

module.exports = { Badge, BADGE_METRICS, BADGE_OPERATORS };
