const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "singleton", unique: true },
    radarRadiusKm: { type: Number, default: 8 },
    dropTtlDays: { type: Number, default: 14 },
    minAppVersion: { type: String, default: "1.0.0" },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.models.AppSettings || mongoose.model("AppSettings", appSettingsSchema);
