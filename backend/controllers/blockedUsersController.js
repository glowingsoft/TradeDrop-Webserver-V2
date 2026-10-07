const BlockedUser = require("../models/BlockedUser");
const Connection = require("../models/Connection");
const MessageRequest = require("../models/MessageRequest");
const { User } = require("@UsersModel");
const { sendResponse, validateParams, parsePaginationParams, generateMeta } = require("../helperUtils/responseUtil");

const blockUser = async (req, res) => {
  if (!validateParams(req, res, { rawData: ["userId"], objectIdFields: ["userId"] })) return;
  const blockedBy = req.user._id;
  const { userId, reason = "" } = req.body;

  if (String(userId) === String(blockedBy)) {
    return sendResponse({ res, statusCode: 400, translationKey: "cannot_block_yourself" });
  }

  try {
    const target = await User.findById(userId).select("_id deletedAt").lean();
    if (!target || target.deletedAt) {
      return sendResponse({ res, statusCode: 404, translationKey: "user_not_found" });
    }

    let blockDoc;
    try {
      blockDoc = await BlockedUser.create({ blockedBy, blockedUser: userId, reason: String(reason || "") });
    } catch (err) {
      if (err && err.code === 11000) {
        return sendResponse({ res, statusCode: 409, translationKey: "user_already_blocked" });
      }
      throw err;
    }

    const [user1, user2] = Connection.normalizePair(blockedBy, userId);
    await Connection.findOneAndUpdate({ user1, user2 }, { $set: { status: "blocked" } });
    await MessageRequest.updateMany(
      { sender: userId, receiver: blockedBy, status: "pending" },
      { $set: { status: "blocked", respondedAt: new Date() } },
    );

    return sendResponse({ res, statusCode: 201, translationKey: "user_blocked", data: blockDoc });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const unblockUser = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["userId"], objectIdFields: ["userId"] })) return;
  const blockedBy = req.user._id;
  const { userId } = req.params;

  try {
    const deleted = await BlockedUser.findOneAndDelete({ blockedBy, blockedUser: userId });
    if (!deleted) {
      return sendResponse({ res, statusCode: 404, translationKey: "block_not_found" });
    }

    const reverseBlock = await BlockedUser.findOne({ blockedBy: userId, blockedUser: blockedBy }).lean();
    if (!reverseBlock) {
      const [user1, user2] = Connection.normalizePair(blockedBy, userId);
      await Connection.findOneAndUpdate({ user1, user2, status: "blocked" }, { $set: { status: "active" } });
    }

    return sendResponse({ res, statusCode: 200, translationKey: "user_unblocked" });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const listBlockedUsers = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const filter = { blockedBy: req.user._id };

  try {
    const [items, total] = await Promise.all([
      BlockedUser.find(filter)
        .populate("blockedUser", "name handle profileIcon avatarUrl")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      BlockedUser.countDocuments(filter),
    ]);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "blocked_users_fetched",
      data: items,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

module.exports = { blockUser, unblockUser, listBlockedUsers };
