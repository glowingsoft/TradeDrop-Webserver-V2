const mongoose = require("mongoose");

const languageSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "language_title_required"], // Custom error message key
    },
    transliteration: {
      type: String,
      default: "",
      trim: true,
      required: [true, "language_transliteration_required"],
    },
    flag: {
      type: String,
      default: "",
    },
    code: {
      type: String,
      required: [true, "language_code_required"], // Custom error message key
    },
    status: {
      type: String,
      enum: ["active", "inactive", "deleted"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

// Exclude sensitive fields when returning language object
languageSchema.methods.toJSON = function () {
  const language = this;
  const languageObject = language.toObject();

  // Attach base URL to flag
  const baseUrl = `${process.env.S3_BASE_URL}`;
  if (languageObject.flag && !languageObject.flag.startsWith("http")) {
    languageObject.flag = `${baseUrl}${languageObject.flag}`;
  } else if (!languageObject.flag) {
    languageObject.flag = `${baseUrl}noimage.png`;
  }

  return languageObject;
};



module.exports = mongoose.model("Language", languageSchema);
