const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
      default: "direct",
    },
    participants: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["admin", "member", "guest"], // Optional: you can add more roles
          default: "member",
        },
        chatState: {
          type: String,
          enum: [
            "default",
            "favorite",
            "archived",
            "blocked",
          ],
          default: "default",
        },
        isActive: {
          type: Boolean,
          default: true, // track if the user is currently part of the conversation
        },
        removedAt: {
          type: Date,
        },
      },
    ],
    groupName: {
      type: String,
      required: function () {
        return this.type === "group";
      },
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    groupMetadata: {
      image: {
        type: String, // URL to the group image
      },
      description: {
        type: String,
      },
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    unreadCounts: {
      // userId -> unread count map, store as object or array
      type: Map,
      of: Number,
      default: {},
    },
    groupSettings: {
      canMessage: {
        type: Boolean,
        default: true, // Can members send messages or only admins
      },
      isPrivate: {
        type: Boolean,
        default: false, // Is this a private group
      },
    },
    isArchived: {
      type: Boolean,
      default: false, // Indicates if the conversation is archived
    },
    lastActivity: {
      type: Map,
      of: Date, // Maps userId to their last activity timestamp
      default: {},
    },
    deletedAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },

  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessage: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
