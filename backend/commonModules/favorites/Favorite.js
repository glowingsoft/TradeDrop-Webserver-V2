const mongoose = require("mongoose");

const FavoriteTargetTypes = ["menu", "event", "organization"];

const favoriteSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        targetId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
            refPath: "targetType",
        },
        targetType: {
            type: String,
            required: true,
            enum: FavoriteTargetTypes,
            index: true,
        },
    },
    { timestamps: true }
);

// Prevent duplicate favorites by the same user
favoriteSchema.index({ user: 1, targetId: 1, targetType: 1 }, { unique: true });

const Favorites = mongoose.model("Favorites", favoriteSchema);
module.exports = { Favorites, FavoriteTargetTypes };
