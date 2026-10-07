const mongoose = require("mongoose");
const MessageRequest = require("../models/MessageRequest");
const BlockedUser = require("../models/BlockedUser");
const Conversation = require("../commonModules/chatModule/models/Conversation");
const Message = require("../commonModules/chatModule/models/Message");
const { User } = require("@UsersModel");
const { sendResponse, validateParams, parsePaginationParams, generateMeta } = require("../helperUtils/responseUtil");
const { isBlockedBetween, isActivelyConnected } = require("../helperUtils/connectionUtil");

const createMessageRequest = async (req, res) => {
  if (!validateParams(req, res, { rawData: ["receiverId"], objectIdFields: ["receiverId"] })) return;
  const senderId = req.user._id;
  const { receiverId, message = "" } = req.body;

  if (String(receiverId) === String(senderId)) {
    return sendResponse({ res, statusCode: 400, translationKey: "cannot_message_yourself" });
  }
  if (String(message).length > 500) {
    return sendResponse({ res, statusCode: 400, translationKey: "message_too_long" });
  }

  try {
    const receiver = await User.findById(receiverId).select("_id deletedAt").lean();
    if (!receiver || receiver.deletedAt) {
      return sendResponse({ res, statusCode: 404, translationKey: "user_not_found" });
    }
    if (await isBlockedBetween(senderId, receiverId)) {
      return sendResponse({ res, statusCode: 403, translationKey: "blocked_user" });
    }
    if (await isActivelyConnected(senderId, receiverId)) {
      return sendResponse({ res, statusCode: 409, translationKey: "users_already_connected" });
    }

    const messageRequest = await MessageRequest.create({
      sender: senderId,
      receiver: receiverId,
      message: String(message || "").trim(),
      status: "pending",
    });

    return sendResponse({ res, statusCode: 201, translationKey: "message_request_sent", data: messageRequest });
  } catch (error) {
    if (error && error.code === 11000) {
      return sendResponse({ res, statusCode: 409, translationKey: "message_request_duplicate" });
    }
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const listIncoming = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const filter = { receiver: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  try {
    const [items, total] = await Promise.all([
      MessageRequest.find(filter)
        .populate("sender", "name handle profileIcon avatarUrl")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MessageRequest.countDocuments(filter),
    ]);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "message_requests_fetched",
      data: items,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const listOutgoing = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const filter = { sender: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  try {
    const [items, total] = await Promise.all([
      MessageRequest.find(filter)
        .populate("receiver", "name handle profileIcon avatarUrl")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MessageRequest.countDocuments(filter),
    ]);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "message_requests_fetched",
      data: items,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

async function requireOwnedPendingRequest(id, receiverId) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return MessageRequest.findOne({ _id: id, receiver: receiverId, status: "pending" });
}

const acceptMessageRequest = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const messageRequest = await requireOwnedPendingRequest(req.params.id, req.user._id);
    if (!messageRequest) {
      return sendResponse({ res, statusCode: 404, translationKey: "message_request_not_found" });
    }
    if (await isBlockedBetween(messageRequest.sender, messageRequest.receiver)) {
      return sendResponse({ res, statusCode: 403, translationKey: "blocked_user" });
    }

    messageRequest.status = "accepted";
    messageRequest.respondedAt = new Date();
    await messageRequest.save();

    // Accepting a message request enables normal chat, but must NOT create a Connection.
    let conversation = await Conversation.findOne({
      type: "direct",
      "participants.user": { $all: [messageRequest.sender, messageRequest.receiver] },
      $expr: { $eq: [{ $size: "$participants" }, 2] },
    });
    if (!conversation) {
      conversation = await Conversation.create({
        type: "direct",
        participants: [
          { user: messageRequest.sender, role: "member" },
          { user: messageRequest.receiver, role: "member" },
        ],
        unreadCounts: { [messageRequest.sender]: 0, [messageRequest.receiver]: 0 },
      });
    }
    if (messageRequest.message) {
      const firstMessage = await Message.create({
        conversationId: conversation._id,
        senderId: messageRequest.sender,
        messageType: "text",
        messageContent: messageRequest.message,
        readBy: [messageRequest.sender],
      });
      conversation.lastMessage = firstMessage._id;
      await conversation.save();
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "message_request_accepted",
      data: { messageRequest, conversationId: conversation._id },
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const rejectMessageRequest = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const messageRequest = await requireOwnedPendingRequest(req.params.id, req.user._id);
    if (!messageRequest) {
      return sendResponse({ res, statusCode: 404, translationKey: "message_request_not_found" });
    }
    messageRequest.status = "rejected";
    messageRequest.respondedAt = new Date();
    await messageRequest.save();
    return sendResponse({ res, statusCode: 200, translationKey: "message_request_rejected", data: messageRequest });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const blockMessageRequest = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const messageRequest = await requireOwnedPendingRequest(req.params.id, req.user._id);
    if (!messageRequest) {
      return sendResponse({ res, statusCode: 404, translationKey: "message_request_not_found" });
    }
    messageRequest.status = "blocked";
    messageRequest.respondedAt = new Date();
    await messageRequest.save();

    try {
      await BlockedUser.create({
        blockedBy: req.user._id,
        blockedUser: messageRequest.sender,
        reason: "message_request",
      });
    } catch (err) {
      if (!err || err.code !== 11000) throw err;
    }

    return sendResponse({ res, statusCode: 200, translationKey: "message_request_blocked", data: messageRequest });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

module.exports = {
  createMessageRequest,
  listIncoming,
  listOutgoing,
  acceptMessageRequest,
  rejectMessageRequest,
  blockMessageRequest,
};
