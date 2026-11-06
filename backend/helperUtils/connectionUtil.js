const Connection = require("../models/Connection");
const ConnectionRequest = require("../models/ConnectionRequest");
const BlockedUser = require("../models/BlockedUser");

function normalizePair(userA, userB) {
  return Connection.normalizePair(userA, userB);
}

/** True when either user has blocked the other. */
async function isBlockedBetween(userA, userB) {
  const blocked = await BlockedUser.findOne({
    $or: [
      { blockedBy: userA, blockedUser: userB },
      { blockedBy: userB, blockedUser: userA },
    ],
  }).lean();
  return Boolean(blocked);
}

async function getConnectionBetween(userA, userB) {
  return Connection.findOne({ pairKey: Connection.pairKeyFor(userA, userB) }).lean();
}

async function isActivelyConnected(userA, userB) {
  const connection = await getConnectionBetween(userA, userB);
  return Boolean(connection && connection.status === "active");
}

function connectionStatusFor(viewerId, userId, connection, request) {
  const self = String(viewerId) === String(userId);
  const hasConnection = !self && Boolean(connection && connection.status === "active");
  const requestSent = !self && !hasConnection && request?.status === "pending" &&
    String(request.requesterId) === String(viewerId);
  const incoming = !self && !hasConnection && request?.status === "pending" &&
    String(request.recipientId) === String(viewerId);
  const inCooldown = request?.status === "declined" && request.cooldownUntil > new Date();
  const connectionStatus = self
    ? "self"
    : hasConnection
      ? "connected"
      : incoming
        ? "incoming_request"
        : requestSent
          ? "request_sent"
          : request?.status === "declined"
            ? "declined"
            : "not_connected";
  return {
    hasConnection,
    connectionId: hasConnection ? String(connection._id) : null,
    requestId: requestSent ? String(request._id) : null,
    requestSent: Boolean(requestSent),
    connectionStatus,
    canSendConnectionRequest: !self && !hasConnection && !incoming && !requestSent && !inCooldown,
  };
}

async function getConnectionStatuses(viewerId, userIds) {
  const ids = [...new Set(userIds.map(String))].filter((id) => id !== String(viewerId));
  const result = new Map();
  if (userIds.some((id) => String(id) === String(viewerId))) {
    result.set(String(viewerId), connectionStatusFor(viewerId, viewerId, null, null));
  }
  if (!ids.length) return result;
  const pairKeys = ids.map((id) => Connection.pairKeyFor(viewerId, id));
  const [connections, requests] = await Promise.all([
    Connection.find({ pairKey: { $in: pairKeys }, status: "active" }).lean(),
    ConnectionRequest.find({ pairKey: { $in: pairKeys }, status: { $in: ["pending", "declined"] } })
      .sort({ createdAt: -1, _id: -1 })
      .lean(),
  ]);
  const connectionsByPair = new Map(connections.map((item) => [item.pairKey, item]));
  const requestsByPair = new Map();
  for (const request of requests) {
    if (!requestsByPair.has(request.pairKey)) requestsByPair.set(request.pairKey, request);
  }
  for (const id of ids) {
    const pair = Connection.pairKeyFor(viewerId, id);
    result.set(id, connectionStatusFor(viewerId, id, connectionsByPair.get(pair), requestsByPair.get(pair)));
  }
  return result;
}

async function getConnectionStatus(viewerId, userId) {
  const statuses = await getConnectionStatuses(viewerId, [userId]);
  return statuses.get(String(userId));
}

/**
 * Records a completed trade between two users: creates the active connection on
 * first completion and bumps completedCount. Atomic upsert backed by the unique
 * pairKey index, so concurrent calls for the same pair cannot create duplicates.
 */
async function recordCompletedTrade(userA, userB, { session } = {}) {
  const [a, b] = normalizePair(userA, userB);
  const pairKey = `${a}_${b}`;
  const run = () =>
    Connection.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: { pairKey, userA: a, userB: b, status: "active", source: "trade" },
        $inc: { completedCount: 1 },
      },
      { new: true, upsert: true, session },
    );
  try {
    return await run();
  } catch (err) {
    // Lost the upsert race; the document now exists, so the update path applies.
    if (err && err.code === 11000 && !session) return run();
    throw err;
  }
}

module.exports = {
  normalizePair,
  isBlockedBetween,
  getConnectionBetween,
  isActivelyConnected,
  connectionStatusFor,
  getConnectionStatus,
  getConnectionStatuses,
  recordCompletedTrade,
};
