const Message = require("../models/Message");
const mongoose = require("mongoose");
const moment = require("moment");
const Conversation = require("../models/Conversation");

const {
  sendResponse,
  parsePaginationParams,
  generateMeta,
  validateParams,
  convertUtcToTimezone,
} = require("@helperUtils/responseUtil");

const { NotificationTypes } = require("../../../models/Notifications");

const {
  getChatNamespace,
  getConnectedUserIds,
  emitMessageToUsers,
  emitChatUpdatedToUser,
} = require("../sockets/chatEventEmitter");
const { getUsersOnlineMap } = require("../sockets/chatPresenceRedis");
const { sendUserNotifications } = require("../../../controllers/communicationController");
const { logEngagementService } = require("../../appEngagement/engagementEventsService");
const { User } = require("@UsersModel");
const Trade = require("@models/Trade");
const Circle = require("@models/Circle");
const CircleMember = require("@models/CircleMember");
const { isBlockedBetween, isActivelyConnected } = require("../../../helperUtils/connectionUtil");

function activeConversationParticipant(conversation, userId) {
  return conversation.participants?.some(
    (participant) => String(participant.user?._id || participant.user) === String(userId) && participant.isActive !== false,
  );
}

async function canAccessConversation(conversation, userId, { send = false } = {}) {
  if (!conversation || conversation.isDeleted) return false;
  if (!activeConversationParticipant(conversation, userId)) return false;
  if (conversation.type === "direct") {
    const other = conversation.participants.find(
      (participant) => String(participant.user?._id || participant.user) !== String(userId),
    )?.user;
    if (!other) return false;
    if (send) return !(await isBlockedBetween(userId, other)) && (await isActivelyConnected(userId, other));
    return true;
  }
  if (conversation.type === "project") {
    const trade = await Trade.findOne({
      _id: conversation.tradeId,
      $or: [{ requesterId: userId }, { responderId: userId }],
    })
      .select("requesterId responderId")
      .lean();
    if (!trade) return false;
    const otherId = String(trade.requesterId) === String(userId) ? trade.responderId : trade.requesterId;
    return !send || !(await isBlockedBetween(userId, otherId));
  }
  if (conversation.circleId) {
    const [circle, member] = await Promise.all([
      Circle.exists({ _id: conversation.circleId, deletedAt: null }),
      CircleMember.exists({ circleId: conversation.circleId, userId, status: "active" }),
    ]);
    return Boolean(circle && member);
  }
  return true;
}

const fetchChats = async (req, res) => {
  const { _id: userId, timezone } = req.user;
  const { page, limit } = parsePaginationParams(req);
  const { keyword, chatState } = req.query;

  try {
    const chatStateMap = {
      inbox: ["default", "favorite"],
      favorite: ["favorite"],
      archived: ["archived"],
      blocked: ["blocked"],
    };

    const allowedStates = chatStateMap[chatState] || ["default", "favorite"];

    const baseMatch = {
      isDeleted: { $ne: true },
      participants: {
        $elemMatch: {
          user: userId,
          isActive: true,
          chatState: { $in: allowedStates },
        },
      },
    };

    const keywordFilter = keyword?.trim()
      ? {
          $or: [
            { groupName: { $regex: keyword, $options: "i" } },
            {
              $and: [
                { type: "direct" },
                {
                  userDetails: {
                    $elemMatch: {
                      _id: { $ne: userId },
                      name: { $regex: keyword, $options: "i" },
                    },
                  },
                },
              ],
            },
          ],
        }
      : null;

    const sharedPipeline = [
      { $match: baseMatch },

      {
        $addFields: {
          currentParticipant: {
            $first: {
              $filter: {
                input: "$participants",
                as: "participant",
                cond: {
                  $eq: ["$$participant.user", new mongoose.Types.ObjectId(userId)],
                },
              },
            },
          },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "participants.user",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      {
        $lookup: {
          from: "messages",
          localField: "lastMessage",
          foreignField: "_id",
          as: "lastMessageData",
        },
      },
      {
        $unwind: {
          path: "$lastMessageData",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "lastMessageData.senderId",
          foreignField: "_id",
          as: "lastMessageSender",
        },
      },
      {
        $unwind: {
          path: "$lastMessageSender",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    // Pipeline for paginated data
    const paginatedPipeline = [
      ...sharedPipeline,
      ...(keywordFilter ? [{ $match: keywordFilter }] : []),
      { $sort: { updatedAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ];

    // Pipeline for total count
    const countPipeline = [
      ...sharedPipeline,
      ...(keywordFilter ? [{ $match: keywordFilter }] : []),
      { $count: "count" },
    ];

    const [conversations, countResult] = await Promise.all([
      Conversation.aggregate(paginatedPipeline),
      Conversation.aggregate(countPipeline),
    ]);

    const totalConversations = countResult[0]?.count || 0;

    const directPeerUserIds = conversations
      .filter((conv) => conv.type === "direct")
      .map((conv) => conv.userDetails.find((u) => u._id.toString() !== userId.toString())?._id)
      .filter(Boolean)
      .map((id) => id.toString());

    const onlineMap = await getUsersOnlineMap(directPeerUserIds);

    const formattedChats = conversations.map((conv) => {
      const unreadCounts = new Map(Object.entries(conv.unreadCounts || {}));
      let objectId,
        chatName,
        chatIcon,
        otherUser = null,
        currentUser = null;

      if (conv.type === "direct") {
        otherUser = conv.userDetails.find((u) => u._id.toString() !== userId.toString());

        objectId = otherUser?._id || null;
        chatName = otherUser?.name || "Unknown";
        chatIcon = otherUser?.profileIcon || null;
      } else {
        objectId = conv._id;
        chatName = conv.groupName || "Unnamed Group";
        chatIcon = conv.groupMetadata?.image || null;
      }

      const lastMsg = conv.lastMessageData || {};
      const localDate = lastMsg.createdAt ? convertUtcToTimezone(lastMsg.createdAt, timezone) : null;
      const timesince = localDate ? moment(localDate).fromNow() : null;

      return {
        conversationId: conv._id,
        type: conv.type,
        objectId,
        chatName,
        chatIcon: chatIcon ? `${process.env.S3_BASE_URL}${chatIcon}` : null,
        chatState: conv.currentParticipant?.chatState || "default",

        isOnline: conv.type === "direct" && objectId ? Boolean(onlineMap.get(objectId.toString())) : false,
        lastMessage: {
          _id: lastMsg._id,
          messageContent: lastMsg.messageContent,
          messageType: lastMsg.messageType,
          senderId: conv.lastMessageSender?._id,
          senderName: conv.lastMessageSender?.name,
          timesince,
        },
        unreadCount: unreadCounts.get(userId.toString()) || 0,
        canMessage: conv.groupSettings?.canMessage ?? false,
      };
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Chats fetched successfully",
      data: formattedChats,
      meta: generateMeta(page, limit, totalConversations),
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "Error fetching chats",
      error,
    });
  }
};

// Fetch messages (pagination)
const fetchMessages = async (req, res) => {
  const { _id: userId, timezone } = req.user;
  let { conversationId, objectId } = req.query;
  const { page, limit } = parsePaginationParams(req);

  try {
    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId).lean();
    } else if (objectId) {
      // Find the conversation for direct chat with the other user
      conversation = await Conversation.findOne({
        type: "direct",
        "participants.user": { $all: [userId, objectId] }, // Ensure both users are participants
        $expr: { $eq: [{ $size: "$participants" }, 2] }, // Ensure there are exactly 2 participants
      }).lean();
      conversationId = conversation?._id; // Set conversationId from found conversation
    } else {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "Conversation ID or Object ID is required",
      });
    }
    if (!conversation) {
      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "Messages fetched successfully",
        data: [],
        meta: generateMeta(page, limit, 0),
      });
    }

    if (!(await canAccessConversation(conversation, userId))) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "Access denied to conversation",
      });
    }

    await Promise.all([
      Message.updateMany(
        { conversationId, senderId: { $ne: userId }, "readBy.userId": { $ne: userId } },
        { $addToSet: { readBy: { userId, readAt: new Date() } } },
      ),
      Conversation.updateOne({ _id: conversationId }, { $set: { [`unreadCounts.${userId}`]: 0 } }),
    ]);

    const messages = await Message.find({ conversationId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const totalMessages = await Message.countDocuments({ conversationId });

    const formattedMessages = messages.map((msg) => {
      const localDate = convertUtcToTimezone(msg.createdAt, timezone);
      const isRead = msg.readBy.some(
        (entry) => String(entry.userId?._id || entry.userId || entry) === String(userId),
      );

      return {
        ...msg,
        timesince: moment(localDate).fromNow(),
        isRead, // Whether the message has been read by the current user
      };
    });

    formattedMessages.forEach((msg) => {
      delete msg.readBy; // Optional: remove the readBy array if it's not needed in the response
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Messages fetched successfully",
      data: formattedMessages,
      meta: generateMeta(page, limit, totalMessages),
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "Error fetching messages",
      error: error.message,
    });
  }
};

const sendMessage = async (req, res) => {
  const { _id: senderId, timezone } = req.user;
  const { conversationId, replyTo } = req.body;
  let messageType, messageContent, mediaUrl, participantIds, conversationType, groupName, participantId;

  if (req.body.conversationType === "group") {
    // Params for group chat
    ({
      messageType,
      messageContent = "",
      mediaUrl = null,
      participantIds = [],
      conversationType = "group",
      groupName,
    } = req.body);
  } else if (req.body.conversationType === "direct") {
    // Params for direct chat (default)
    ({ messageType, messageContent = "", mediaUrl = null, participantId = "", conversationType = "direct" } = req.body);
  } else if (req.body.conversationType === "project") {
    ({ messageType, messageContent = "", mediaUrl = null, conversationType = "project" } = req.body);
  }

  try {
    let conversation;

    // For 1-to-1 direct chat: find or create conversation between two users
    if (conversationType === "direct") {
      //if conversationId is provided, find the conversation
      if (conversationId) {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
          return sendResponse({
            res,
            statusCode: 400,
            translationKey: "Invalid conversation ID",
          });
        }
        conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          return sendResponse({
            res,
            statusCode: 404,
            translationKey: "Direct conversation not found",
          });
        }
        if (conversation.type !== "direct") {
          return sendResponse({ res, statusCode: 400, translationKey: "Invalid direct conversation" });
        }

        if (!(await canAccessConversation(conversation, senderId, { send: true }))) {
          return sendResponse({
            res,
            statusCode: 403,
            translationKey: "connection_required_or_access_denied",
          });
        }
      } else {
        participantIds = participantId ? [participantId] : []; // Ensure participantIds is an array
        if (!participantIds.length || participantIds.length !== 1) {
          return sendResponse({
            res,
            statusCode: 400,
            translationKey: "Must provide exactly one participant for direct chat",
          });
        }

        const otherUserId = participantIds[0];

        if (await isBlockedBetween(senderId, otherUserId)) {
          return sendResponse({
            res,
            statusCode: 403,
            translationKey: "blocked_user",
          });
        }

        // Find existing direct conversation between these two users
        conversation = await Conversation.findOne({
          type: "direct",
          "participants.user": { $all: [senderId, otherUserId] }, // Ensure both users are in participants array
          $expr: { $eq: [{ $size: "$participants" }, 2] }, // Ensure there are exactly 2 participants
        });

        if (!conversation) {
          if (!(await isActivelyConnected(senderId, otherUserId))) {
            return sendResponse({ res, statusCode: 403, translationKey: "connection_required" });
          }

          // Create new direct conversation if not found
          conversation = await Conversation.create({
            type: "direct",
            participants: [
              { user: senderId, role: "admin" }, // Role for the sender (can be admin or member)
              { user: otherUserId, role: "member" }, // Role for the other participant
            ],
            unreadCounts: { [senderId]: 0, [otherUserId]: 0 }, // Initialize unread counts for both users
          });
        }
      }
      if (!(await canAccessConversation(conversation, senderId, { send: true }))) {
        return sendResponse({ res, statusCode: 403, translationKey: "connection_required_or_access_denied" });
      }
    } else if (conversationType === "group") {
      // Handle group messages
      if (conversationId) {
        conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          return sendResponse({
            res,
            statusCode: 404,
            translationKey: "Group conversation not found",
          });
        }
        if (conversation.type !== "group") {
          return sendResponse({ res, statusCode: 400, translationKey: "Invalid group conversation" });
        }
        if (!(await canAccessConversation(conversation, senderId, { send: true }))) {
          return sendResponse({ res, statusCode: 403, translationKey: "circle_membership_required" });
        }
      } else {
        if (!groupName) {
          return sendResponse({
            res,
            statusCode: 400,
            translationKey: "Group name required for new group chat",
          });
        }

        // Create a new group conversation
        conversation = await Conversation.create({
          type: "group",
          groupName,
          participants: [
            { user: senderId, role: "admin" }, // Admin role for the creator of the group
            ...(Array.isArray(participantIds) && participantIds.length
              ? participantIds.map((id) => ({ user: id, role: "member" }))
              : []), // Set other participants as members if provided
          ],
          admins: [senderId], // Add creator as the admin
          unreadCounts: {}, // Will be updated below
        });
      }
    } else if (conversationType === "project") {
      if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
        return sendResponse({ res, statusCode: 400, translationKey: "conversation_id_required" });
      }
      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return sendResponse({ res, statusCode: 404, translationKey: "Project conversation not found" });
      }
      if (conversation.type !== "project") {
        return sendResponse({ res, statusCode: 400, translationKey: "Invalid project conversation" });
      }
      if (!(await canAccessConversation(conversation, senderId, { send: true }))) {
        return sendResponse({ res, statusCode: 403, translationKey: "collaboration_participant_required" });
      }
    } else {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "Unsupported conversation type",
      });
    }

    let replyToId = null;
    if (replyTo !== undefined && replyTo !== null && replyTo !== "") {
      if (!mongoose.Types.ObjectId.isValid(replyTo)) {
        return sendResponse({ res, statusCode: 400, translationKey: "Invalid reply message ID" });
      }
      const parentMessage = await Message.findOne({
        _id: replyTo,
        conversationId: conversation._id,
        isDeleted: { $ne: true },
      })
        .select("_id")
        .lean();
      if (!parentMessage) {
        return sendResponse({ res, statusCode: 404, translationKey: "Reply message not found in conversation" });
      }
      replyToId = parentMessage._id;
    }

    // Create the message
    const message = await Message.create({
      conversationId: conversation._id,
      senderId,
      messageType,
      messageContent,
      mediaUrl,
      replyTo: replyToId,
      readBy: [{ userId: senderId, readAt: new Date() }],
    });

    // Log engagement
    void logEngagementService({
      entityType: "message",
      entityId: message._id,
      ownerUserId: senderId,
      eventType: "message",
      userId: senderId,
    }).catch(console.error);

    // Update conversation with last message and unread counts
    conversation.lastMessage = message._id;
    conversation.participants.forEach((p) => {
      if (p.user.toString() !== senderId.toString()) {
        const count = conversation.unreadCounts.get(p.user.toString()) || 0;
        conversation.unreadCounts.set(p.user.toString(), count + 1);
      }
    });
    await conversation.save();

    const localDate = moment(message.createdAt).tz(timezone).format();
    let messageObject = {
      ...message.toObject(),
      timesince: moment(localDate).fromNow(),
    };

    // Background task for emitting messages and notifications
    const handleBackgroundTask = async () => {
      try {
        // For direct chat, objectId is the other user's ID
        // For group chat, objectId is the group/conversation ID
        let objectId, subjectId;

        if (conversation.type === "direct") {
          const otherUser = conversation.participants.find((p) => p.user.toString() !== senderId.toString());
          objectId = otherUser?.user?._id.toString(); // Other user in direct conversation
          subjectId = senderId.toString();
        } else {
          objectId = conversation._id.toString(); // Use conversation ID for group chats
          subjectId = senderId.toString();
        }

        const chatNamespace = getChatNamespace(req.io || global.io);
        if (!chatNamespace) {
          throw new Error("Chat socket namespace is not initialized");
        }

        // For group chat, we need to loop over all participants
        const recipientIds = conversation.participants
          .filter((p) => p.user.toString() !== senderId.toString()) // Exclude sender
          .map((p) => p.user.toString()); // Get an array of recipient IDs for group chat

        // Determine online recipients from Redis-synced room presence.
        const connectedRecipientIds = await getConnectedUserIds(chatNamespace, recipientIds);

        // Reset unread counts for all connected recipients in one update
        if (connectedRecipientIds.length > 0) {
          connectedRecipientIds.forEach((id) => {
            conversation.unreadCounts.set(id, 0);
          });
        }

        // Always reset sender's unread count
        conversation.unreadCounts.set(senderId.toString(), 0);

        // Save conversation once after all updates (in background)
        conversation.save().catch(() => {});

        emitMessageToUsers({
          ioOrNamespace: chatNamespace,
          recipientIds,
          message: messageObject,
        });

        //add current user name and profile icon to messageObject
        messageObject.chatName = req.user.name;
        messageObject.chatIcon = req.user.profileIcon ? `${process.env.S3_BASE_URL}${req.user.profileIcon}` : null;
        messageObject.conversationId = conversation._id.toString();
        messageObject.conversationType = conversation.type;

        // Emit chatUpdated to recipients in their personal user rooms.
        recipientIds.forEach((recipientId) => {
          const unreadCount = conversation.unreadCounts.get(recipientId) || 0;

          emitChatUpdatedToUser({
            ioOrNamespace: chatNamespace,
            recipientId,
            payload: {
              subjectId,
              objectId,
              senderName: req.user.name,
              messageContent: messageObject,
              unreadCount,
            },
          });
        });
        const user = await User.findById(senderId).select("name -_id").lean();
        console.log("user", user);

        // Send notifications to all group participants (excluding sender)
        if (conversation.type === "group") {
          //remove current user from recipientIds
          const index = recipientIds.indexOf(senderId.toString());
          if (index > -1) {
            recipientIds.splice(index, 1);
          }
          await sendUserNotifications({
            recipientIds: recipientIds, // Send notification to each participant
            title: "New Message",
            body: `You received a new message: ${messageContent}`,
            data: { type: NotificationTypes.NEW_MESSAGE, objectType: "group" },
            sender: subjectId,
            objectId: objectId,
          });
        }

        // If it's a direct message, send a notification to the other user
        if (conversation.type === "direct") {
          await sendUserNotifications({
            recipientIds: [objectId], // Direct recipient
            title: "New Message",
            body: `You received a new message: ${messageContent}`,
            data: { type: NotificationTypes.NEW_MESSAGE, objectType: "user" },
            sender: subjectId,
            objectId: objectId,
          });
        }
      } catch (error) {
        console.error("Error in background task:", error);
      }
    };
    // Execute background task
    handleBackgroundTask();

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "Message sent successfully",
      data: messageObject,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message || "Error sending message",
      error: error,
    });
  }
};

//add participant to group chat
const addParticipantToGroup = async (req, res) => {
  const { _id: userId } = req.user;
  const { conversationId } = req.params;
  let { participants } = req.body;

  // Ensure participants is always an array
  if (!Array.isArray(participants)) {
    participants = participants ? [participants] : [];
  }

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "Invalid conversation ID",
    });
  }
  if (!participants.length) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "No participant IDs provided",
    });
  }
  // Validate all participant IDs
  for (const id of participants) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: `Invalid participant ID: ${id}`,
      });
    }
  }
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "Conversation not found",
      });
    }
    if (conversation.type !== "group") {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "Only group conversations can have participants added",
      });
    }
    if (!activeConversationParticipant(conversation, userId)) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "You do not have permission to add participants",
      });
    }
    if (conversation.circleId) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "circle_members_must_join_through_circle_api",
      });
    }
    // Filter out participant IDs already in the group
    const existingIds = conversation.participants.map((p) => p.user.toString());
    const newParticipantIds = participants.filter((id) => !existingIds.includes(id));
    if (!newParticipantIds.length) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey:
          newParticipantIds.length === 1
            ? "Participant is already in the group"
            : "All participants are already in the group",
      });
    }
    // Add new participants
    newParticipantIds.forEach((id) => {
      conversation.participants.push({
        user: id,
        role: "member",
        isActive: true,
      });
      conversation.unreadCounts.set(id.toString(), 0);
    });
    await conversation.save();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Participants added to group successfully",
      data: {
        conversationId: conversation._id,
        participantIds: newParticipantIds,
      },
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message || "Error adding participants",
      error: error.message,
    });
  }
};

// Delete a chat
const deleteChat = async (req, res) => {
  const { _id: userId } = req.user;
  const { conversationId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "Invalid conversation ID",
    });
  }

  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "Conversation not found",
      });
    }

    // Check if the user is a participant in the conversation
    if (!activeConversationParticipant(conversation, userId)) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "You do not have permission to delete this chat",
      });
    }
    if (conversation.type === "project" || conversation.circleId) {
      return sendResponse({ res, statusCode: 403, translationKey: "conversation_cannot_be_deleted" });
    }
    // Delete all messages and the conversation in parallel
    await Promise.all([Message.deleteMany({ conversationId }), Conversation.findByIdAndDelete(conversationId)]);

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Chat deleted successfully",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error,
      error: error,
    });
  }
};

const deleteMessage = async (req, res) => {
  const { messageId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "Invalid message ID",
    });
  }

  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "No such message found",
      });
    }

    // Check if current user is the sender of the message
    if (message.senderId.toString() !== req.user._id.toString()) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "You are not authorized to delete this message",
      });
    }
    const conversation = await Conversation.findById(message.conversationId).lean();
    if (!(await canAccessConversation(conversation, req.user._id))) {
      return sendResponse({ res, statusCode: 403, translationKey: "access_denied" });
    }

    // Soft delete the message (mark as deleted without removing it from DB)
    message.isDeleted = true;
    await message.save();

    // Optionally, you can also delete or update the lastMessage field in the conversation
    const writableConversation = await Conversation.findById(message.conversationId);
    if (writableConversation?.lastMessage && writableConversation.lastMessage.toString() === message._id.toString()) {
      // If the deleted message was the last message, set lastMessage to null
      writableConversation.lastMessage = null;
      await writableConversation.save();
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Message deleted successfully",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error,
      error: error,
    });
  }
};

const chatActionHandler = async (req, res) => {
  const { _id: userId } = req.user;
  const { conversationId } = req.params;
  const { action } = req.body;

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "Invalid conversation ID",
    });
  }

  const validActions = ["default", "favorite", "archived", "blocked"];
  if (!validActions.includes(action)) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "Invalid action",
    });
  }

  try {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "Conversation not found",
      });
    }

    // Find participant (IMPORTANT: per-user state)
    const participant = conversation.participants.find((p) => p.user.toString() === userId.toString());

    if (!participant || participant.isActive === false) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "You do not have permission to perform this action",
      });
    }

    // Update chatState (single enum)
    participant.chatState = action;

    await conversation.save();

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: `Conversation ${action} successfully`,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message || "Error performing action",
      error,
    });
  }
};

// ...existing code...

const fetchAllRooms = async (req, res) => {
  const { _id: userId } = req.user;
  const { page, limit } = parsePaginationParams(req);
  const { keyword } = req.query;
  const currentUserId = new mongoose.Types.ObjectId(userId);

  try {
    const match = {
      type: "group",
      isDeleted: { $ne: true },

      // Public rooms are visible to everyone. Private rooms are visible to members only.
      $or: [
        { "groupSettings.isPrivate": { $ne: true } },
        {
          participants: {
            $elemMatch: {
              user: currentUserId,
              isActive: true,
            },
          },
        },
      ],
    };

    if (keyword?.trim()) {
      match.groupName = {
        $regex: keyword.trim(),
        $options: "i",
      };
    }

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          activeParticipants: {
            $filter: {
              input: "$participants",
              as: "participant",
              cond: { $eq: ["$$participant.isActive", true] },
            },
          },
        },
      },
      {
        $addFields: {
          joined: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$activeParticipants",
                    as: "participant",
                    cond: {
                      $eq: ["$$participant.user", currentUserId],
                    },
                  },
                },
              },
              0,
            ],
          },
          participantCount: { $size: "$activeParticipants" },
        },
      },
      {
        $project: {
          _id: 1,
          groupName: 1,
          groupMetadata: 1,
          groupSettings: 1,
          lastMessage: 1,
          updatedAt: 1,
          createdAt: 1,
          joined: 1,
          participantCount: 1,
        },
      },
      { $sort: { updatedAt: -1 } },
      {
        $facet: {
          rooms: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await Conversation.aggregate(pipeline);
    const totalRooms = result?.totalCount?.[0]?.count || 0;

    const rooms = (result?.rooms || []).map((room) => ({
      conversationId: room._id,
      type: "group",
      groupName: room.groupName,
      groupImage: room.groupMetadata?.image ? `${process.env.S3_BASE_URL}${room.groupMetadata.image}` : null,
      description: room.groupMetadata?.description || null,
      joined: room.joined,
      participantCount: room.participantCount,
      canMessage: room.groupSettings?.canMessage ?? true,
      isPrivate: room.groupSettings?.isPrivate ?? false,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    }));

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Rooms fetched successfully",
      data: rooms,
      meta: generateMeta(page, limit, totalRooms),
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "Error fetching rooms",
      error: error.message,
    });
  }
};

// ...existing code...

module.exports = {
  fetchChats,
  fetchMessages,
  sendMessage,
  deleteChat,
  deleteMessage,
  addParticipantToGroup,
  chatActionHandler,
  fetchAllRooms,
};
