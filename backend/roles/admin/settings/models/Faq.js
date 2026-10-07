// models/FAQ.js
const mongoose = require("mongoose");

const FAQSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },

    answer: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },
    type: {
      type: String,
      enum: ["user", "general", "coach"],
      default: "general",
      index: true
    },
  },
  {
    timestamps: true,
  }
);

const Faq = mongoose.model("Faq", FAQSchema);
module.exports = Faq;
