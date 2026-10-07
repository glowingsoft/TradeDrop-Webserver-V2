const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    chipGroup: {
      type: String,
      required: true,
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    image: { type: String, default: "noimg.png" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Category || mongoose.model("Category", categorySchema);
