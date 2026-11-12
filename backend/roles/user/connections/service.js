const mongoose = require("mongoose");
const Connection = require("@models/Connection");
const ConnectionRequest = require("@models/ConnectionRequest");
const { User } = require("@UsersModel");
const { Drop } = require("@models/Drop");
const { isBlockedBetween, getConnectionBetween } = require("@helperUtils/connectionUtil");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const { withTransaction } = require("../_shared/tradeShared");
const { httpError, idStr } = require("../_shared/serialize");

const COOLDOWN_MS = 30 * 86400000;

function requestView(request) {
  const requester = request.requesterId;
  const recipient = request.recipientId;
  const userView = (user) =>
    user && typeof user === "object" && user._id && ("name" in user || "profileIcon" in user)
      ? {
          _id: idStr(user._id),
          name: user.name || "",
          profileIcon: getFullImageUrl(user.profileIcon),
        }
      : idStr(user);
  return {
    _id: idStr(request._id),
    requesterId: userView(requester),
    recipientId: userView(recipient),
    note: request.note || "",
    status: request.status,
    respondedAt: request.respondedAt || null,
    cooldownUntil: request.cooldownUntil || null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

async function createRequest(userId, body = {}) {
  if (!mongoose.isValidObjectId(body.recipientId)) throw httpError(400, "recipient_id_invalid");
  const recipientId = new mongoose.Types.ObjectId(body.recipientId);
  if (String(recipientId) === String(userId)) throw httpError(400, "cannot_request_self");
  const note = String(body.note || "").trim();
  if (note.length > 500) throw httpError(400, "connection_note_too_long");
  const recipient = await User.findById(recipientId).select("_id deletedAt").lean();
  if (!recipient || recipient.deletedAt) throw httpError(404, "user_not_found");
  if (await isBlockedBetween(userId, recipientId)) throw httpError(403, "user_blocked");
  const connection = await getConnectionBetween(userId, recipientId);
  if (connection?.status === "active") throw httpError(409, "already_connected");
  const pairKey = Connection.pairKeyFor(userId, recipientId);
  const cooldown = await ConnectionRequest.findOne({
    pairKey,
    status: "declined",
    cooldownUntil: { $gt: new Date() },
  })
    .sort({ cooldownUntil: -1 })
    .lean();
  if (cooldown) throw httpError(409, "connection_request_cooldown", { cooldownUntil: cooldown.cooldownUntil });
  try {
    const request = await ConnectionRequest.create({
      pairKey,
      requesterId: userId,
      recipientId,
      note,
      status: "pending",
    });
    await sendUserNotifications({
      recipientIds: [String(recipientId)],
      title: "Connection request",
      body: "You received a connection request.",
      data: { type: "connection_request", objectType: "connection_request" },
      sender: userId,
      objectId: request._id,
    });
    return requestView(request);
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, "connection_request_pending");
    throw error;
  }
}

async function listRequests(userId, direction, req) {
  const { page, limit } = parsePaginationParams(req);
  const field = direction === "incoming" ? "recipientId" : "requesterId";
  const query = { [field]: userId };
  if (req.query.status && ["pending", "accepted", "declined", "withdrawn", "cancelled"].includes(req.query.status)) {
    query.status = req.query.status;
  }
  const [items, total] = await Promise.all([
    ConnectionRequest.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ConnectionRequest.countDocuments(query),
  ]);
  return { data: items.map(requestView), meta: generateMeta(page, limit, total) };
}

async function listMyConnections(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const viewerId = new mongoose.Types.ObjectId(String(userId));
  const [result] = await Connection.aggregate([
    { $match: { status: "active", $or: [{ userA: viewerId }, { userB: viewerId }] } },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $set: { peerId: { $cond: [{ $eq: ["$userA", viewerId] }, "$userB", "$userA"] } } },
    { $lookup: { from: User.collection.name, localField: "peerId", foreignField: "_id", as: "peer" } },
    { $unwind: "$peer" },
    { $match: { "peer.deletedAt": null } },
    {
      $facet: {
        items: [
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { _id: "$peer._id", name: "$peer.name", profileIcon: "$peer.profileIcon" } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);
  return {
    data: result.items.map((user) => ({
      _id: idStr(user._id),
      name: user.name || "",
      profileIcon: getFullImageUrl(user.profileIcon),
    })),
    meta: generateMeta(page, limit, result.total[0]?.count || 0),
  };
}

async function respond(userId, requestId, action) {
  if (!mongoose.isValidObjectId(requestId)) throw httpError(404, "connection_request_not_found");
  const id = new mongoose.Types.ObjectId(requestId);
  const current = await ConnectionRequest.findOne({ _id: id, status: "pending" }).lean();
  if (!current) throw httpError(404, "connection_request_not_found");
  const incoming = String(current.recipientId) === String(userId);
  const outgoing = String(current.requesterId) === String(userId);
  if (action === "withdraw" ? !outgoing : !incoming) throw httpError(403, "access_denied");
  if (await isBlockedBetween(current.requesterId, current.recipientId)) throw httpError(403, "user_blocked");

  const updated = await withTransaction(async (session) => {
    const now = new Date();
    const update =
      action === "decline"
        ? { status: "declined", respondedAt: now, cooldownUntil: new Date(now.getTime() + COOLDOWN_MS) }
        : { status: action === "accept" ? "accepted" : "withdrawn", respondedAt: now };
    const request = await ConnectionRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: update },
      { new: true, session },
    ).lean();
    if (!request) throw httpError(409, "invalid_status_transition");

    if (action === "accept") {
      const [userA, userB] = Connection.normalizePair(request.requesterId, request.recipientId);
      await Connection.findOneAndUpdate(
        { pairKey: request.pairKey },
        {
          $set: { userA, userB, status: "active", source: "connection_request" },
          $setOnInsert: { completedCount: 0 },
        },
        { upsert: true, new: true, session, setDefaultsOnInsert: true },
      );
    }
    return requestView(request);
  });
  const recipientId = action === "withdraw" ? updated.recipientId : updated.requesterId;
  sendUserNotifications({
    recipientIds: [recipientId],
    sender: userId,
    title:
      action === "accept"
        ? "Connection request accepted"
        : action === "decline"
          ? "Connection request declined"
          : "Connection request withdrawn",
    body:
      action === "accept"
        ? "Your connection request was accepted."
        : action === "decline"
          ? "Your connection request was declined."
          : "A connection request was withdrawn.",
    data: { type: "connection_request", objectType: "connection_request" },
    objectId: updated._id,
  });
  return updated;
}

async function getNetwork(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const keyword = String(req.query.keyword || "").trim();
  const connectionsQuery = {
    status: "active",
    $or: [{ userA: userId }, { userB: userId }],
  };
  const [connections, pendingRequests] = await Promise.all([
    Connection.find(connectionsQuery).sort({ updatedAt: -1 }).limit(5).lean(),
    ConnectionRequest.find({ $or: [{ requesterId: userId }, { recipientId: userId }], status: "pending" })
      .populate("requesterId recipientId", "name profileIcon")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);
  const peerIds = connections.map((connection) =>
    String(connection.userA) === String(userId) ? connection.userB : connection.userA,
  );
  const UserCircle = require("@models/Circle");
  const circleIds = await require("../circles/membership").circleIdsFor(userId);
  const Favorite = require("@backend/commonModules/favorites/Favorite").Favorites;
  const [users, circles, saved, openDrops] = await Promise.all([
    User.find({
      _id: { $in: peerIds },
      ...(keyword
        ? {
            $or: [
              { name: { $regex: escapeRegex(keyword), $options: "i" } },
              { handle: { $regex: escapeRegex(keyword), $options: "i" } },
            ],
          }
        : {}),
    })
      .select("name handle profileIcon crafts")
      .populate("crafts", "name image")
      .lean(),
    UserCircle.find({ _id: { $in: circleIds }, deletedAt: null })
      .select("name purpose privacy city")
      .lean(),
    Favorite.find({ user: userId })
      .populate("target", "name handle profileIcon")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Drop.find({
      ownerId: userId,
      status: "open",
      deletedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .select("_id title date")
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return {
    latestConnections: connections
      .map((connection) =>
        byId.get(String(String(connection.userA) === String(userId) ? connection.userB : connection.userA)),
      )
      .filter(Boolean)
      .map((user) => ({
        ...user,
        _id: idStr(user._id),
        profileIcon: getFullImageUrl(user.profileIcon),
        crafts: (user.crafts || []).filter(Boolean).map((craft) => ({
          _id: idStr(craft._id),
          name: craft.name,
          image: getFullImageUrl(craft.image),
        })),
      })),
    pendingRequests: pendingRequests.map(requestView),
    circles: circles.filter(
      (circle) =>
        !keyword || `${circle.name} ${circle.purpose} ${circle.city}`.toLowerCase().includes(keyword.toLowerCase()),
    ),
    openDrops: openDrops.filter(
      (drop) =>
        !keyword ||
        String(drop.title || "")
          .toLowerCase()
          .includes(keyword.toLowerCase()),
    ),
    savedPeople: saved
      .filter(
        (favorite) =>
          favorite.target &&
          (!keyword ||
            `${favorite.target.name} ${favorite.target.handle}`.toLowerCase().includes(keyword.toLowerCase())),
      )
      .map((favorite) => favorite.target),
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { createRequest, listRequests, listMyConnections, respond, getNetwork };
