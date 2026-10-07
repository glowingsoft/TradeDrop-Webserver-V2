const mongoose = require("mongoose");

const cmsPageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      enum: ["terms", "privacy", "about", "faq"],
      lowercase: true,
    },
    title: { type: String, required: true },
    bodyMarkdown: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CmsPage || mongoose.model("CmsPage", cmsPageSchema);
