const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messageType: {
      type: String,
      enum: ["text", "audio", "file"],
      required: true,
      default: "text",
    },
    messageContent: {
      type: String,
      required: function () {
        return this.messageType === "text";  // Message content is required only for text messages
      },
    },
    mediaUrl: {
      type: String,
      required: function () {
        // Only require mediaUrl if messageType is "audio" or "file"
        return this.messageType === "audio" || this.messageType === "file";
      },
      validate: {
        validator: function (value) {
          // For text messages, mediaUrl can be undefined, null, or any string (ignore validation)
          if (this.messageType === "text") {
            return true;
          }
          // For audio or file, mediaUrl must be a non-empty string
          return typeof value === "string" && value.trim().length > 0;
        },
        message: "Media URL must be provided for audio or file messages.",
      },
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
        },
      },
    ],
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message", // Reference to another message if this is a reply
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for faster queries
messageSchema.index({ conversationId: 1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
