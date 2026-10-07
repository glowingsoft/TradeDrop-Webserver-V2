const mongoose = require("mongoose");

const timingChipSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, unique: true, lowercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.models.TimingChip || mongoose.model("TimingChip", timingChipSchema);
