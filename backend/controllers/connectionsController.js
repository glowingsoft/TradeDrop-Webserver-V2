const Connection = require("../models/Connection");
const BlockedUser = require("../models/BlockedUser");
const { User } = require("@UsersModel");
const { sendResponse, validateParams, parsePaginationParams, generateMeta } = require("../helperUtils/responseUtil");

function otherUserId(connection, userId) {
  return String(connection.userA) === String(userId) ? connection.userB : connection.userA;
}

const listConnections = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const isAdmin = req?.user?.userType === "admin";
  const userId = req?.query?.userId || null;

  const status = ["active", "blocked"].includes(req.query.status) ? req.query.status : "active";

  try {
    const filter = { status };

    // Admin: filter by userId only if provided
    if (isAdmin) {
      if (userId) {
        filter.$or = [{ userA: userId }, { userB: userId }];
      }
    } else {
      // Normal user: always filter by logged-in user
      filter.$or = [{ userA: req.user._id }, { userB: req.user._id }];
    }
    const [connections, total] = await Promise.all([
      Connection.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Connection.countDocuments(filter),
    ]);

    const otherIds = connections.map((c) => otherUserId(c, userId));
    const users = await User.find({ _id: { $in: otherIds } })
      .select("name handle profileIcon avatarUrl")
      .lean();
    const usersById = new Map(users.map((u) => [String(u._id), u]));

    const data = connections.map((c) => ({
      _id: c._id,
      status: c.status,
      completedCount: c.completedCount || 0,
      user: usersById.get(String(otherUserId(c, userId))) || null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "connections_fetched",
      data,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const getConnectionWithUser = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["userId"], objectIdFields: ["userId"] })) return;
  const userId = req.user._id;
  const { userId: otherId } = req.params;

  try {
    const [connection, blocked] = await Promise.all([
      Connection.findOne({ pairKey: Connection.pairKeyFor(userId, otherId) }).lean(),
      BlockedUser.findOne({
        $or: [
          { blockedBy: userId, blockedUser: otherId },
          { blockedBy: otherId, blockedUser: userId },
        ],
      }).lean(),
    ]);

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "connection_status_fetched",
      data: {
        connected: Boolean(connection && connection.status === "active"),
        status: connection?.status || "none",
        blocked: Boolean(blocked),
        blockedByMe: blocked ? String(blocked.blockedBy) === String(userId) : false,
      },
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const removeConnection = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["userId"], objectIdFields: ["userId"] })) return;
  const userId = req.user._id;
  const { userId: otherId } = req.params;

  try {
    // Blocked pairs stay in place; a block is lifted via unblock, not removal
    const connection = await Connection.findOneAndDelete({
      pairKey: Connection.pairKeyFor(userId, otherId),
      status: "active",
    });
    if (!connection) {
      return sendResponse({ res, statusCode: 404, translationKey: "connection_not_found" });
    }
    return sendResponse({ res, statusCode: 200, translationKey: "connection_removed", data: connection });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

module.exports = { listConnections, getConnectionWithUser, removeConnection };
