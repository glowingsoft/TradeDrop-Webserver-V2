// models/FAQ.js
const mongoose = require("mongoose");

const HelpCenterSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    article: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      trim: true,
      default: "",
    },
    type: {
      type: String,
      default: "general",
      index: true
    },
  },
  {
    timestamps: true,
  }
);

const HelpCenter = mongoose.model("HelpCenter", HelpCenterSchema);
module.exports = HelpCenter;
