const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    audience: {
      type: {
        type: String,
        enum: ["everyone", "category", "area", "activity"],
        default: "everyone",
      },
      value: {
        type: String,
        default: "",
      },
    },
    publishAt: {
      type: Date,
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
    readBy: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

module.exports = {
  Announcement: mongoose.models.Announcements || mongoose.model("Announcements", announcementSchema),
};
