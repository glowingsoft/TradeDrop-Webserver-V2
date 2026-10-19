const mongoose = require("mongoose");

const favoriteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// One favorite per user/target pair; also serves "my favorites" queries
favoriteSchema.index({ user: 1, target: 1 }, { unique: true });

module.exports = { Favorites: mongoose.model("Favorites", favoriteSchema) };
