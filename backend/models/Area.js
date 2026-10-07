const mongoose = require("mongoose");

const areaSchema = new mongoose.Schema(
  {
    city: { type: String, default: "" },
    label: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

areaSchema.index({ label: 1 });

module.exports = mongoose.models.Area || mongoose.model("Area", areaSchema);
