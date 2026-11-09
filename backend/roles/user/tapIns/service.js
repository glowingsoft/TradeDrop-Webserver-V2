const mongoose = require("mongoose");
const { User } = require("@UsersModel");
const { Drop } = require("@models/Drop");
const TapIn = require("@models/TapIn");
const Trade = require("@models/Trade");
const Category = require("@models/Category");
const TimingChip = require("@models/TimingChip");
const Conversation = require("@backend/commonModules/chatModule/models/Conversation");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { isBlockedBetween, isActivelyConnected, recordCompletedTrade } = require("@helperUtils/connectionUtil");
const { idStr, idStrOrNull, httpError } = require("../_shared/serialize");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const {
  withTransaction,
  toObjectId,
  escapeRegex,
  publicDropFilter,
  assertTradeCapacity,
  dropExpiredFilter,
  textOrEmpty,
  userBrief,
  usersById,
  toDropView,
  toTapInView,
  toTradeView,
  parseDropContent,
  loadOwner,
  DIRECT_KINDS,
} = require("../_shared/tradeShared");

async function sendDirect(kind, userId, targetUserId, body = {}) {
  if (!DIRECT_KINDS.includes(kind)) throw httpError(400, "invalid_kind");
  const targetId = toObjectId(targetUserId, "user_not_found");
  if (String(targetId) === String(userId)) throw httpError(400, "cannot_target_self");

  const [owner, target, content] = await Promise.all([
    loadOwner(userId),
    User.findById(targetId).select("_id deletedAt openToTrade").lean(),
    parseDropContent(body),
  ]);
  if (!target || target.deletedAt) throw httpError(404, "user_not_found");
  if (kind === "collaboration" && target.openToTrade === false) throw httpError(409, "recipient_not_open_to_work");
  if (await isBlockedBetween(userId, targetId)) throw httpError(403, "user_blocked");
  if (kind === "collaboration" && !(await isActivelyConnected(userId, targetId))) {
    throw httpError(403, "connection_required");
  }

  const result = await withTransaction(async (session) => {
    const existing = await Drop.exists({
      ownerId: userId,
      targetUserId: targetId,
      kind,
      visibility: "direct",
      status: "open",
      deletedAt: null,
    }).session(session);
    if (existing) throw httpError(409, "direct_request_already_exists");

    const [drop] = await Drop.create(
      [
        {
          ...content,
          ownerId: userId,
          ownerHandle: owner.handle || "",
          kind,
          visibility: "direct",
          targetUserId: targetId,
          status: "open",
        },
      ],
      { session },
    );
    const [created] = await TapIn.create(
      [
        {
          dropId: drop._id,
          requesterId: userId,
          responderId: targetId,
          notes: textOrEmpty(body.notes, 1000, "notes_too_long"),
          status: "pending",
        },
      ],
      { session },
    );
    return { drop: toDropView(drop.toObject(), userId), tapIn: toTapInView(created.toObject()) };
  });
  sendUserNotifications({
    recipientIds: [String(targetId)],
    sender: userId,
    title: kind === "collaboration" ? "Collaboration request" : "Proposal received",
    body: "You received a new request.",
    data: { type: "tap_in", objectType: "tap_in" },
  });
  return result;
}


async function tapIn(userId, dropId, body = {}) {
  const id = toObjectId(dropId, "drop_not_found");
  const drop = await Drop.findOne({ _id: id, ...publicDropFilter() }).lean();
  if (!drop) throw httpError(404, "drop_not_found");
  if (drop.expiresAt && new Date(drop.expiresAt) <= new Date()) throw httpError(409, "drop_expired");
  if (drop.tapInDeadline && new Date(drop.tapInDeadline) <= new Date()) throw httpError(409, "tap_in_deadline_passed");
  if (String(drop.ownerId) === String(userId)) throw httpError(403, "cannot_tap_own_drop");
  if (await isBlockedBetween(userId, drop.ownerId)) throw httpError(403, "user_blocked");

  try {
    const created = await TapIn.create({
      dropId: drop._id,
      requesterId: userId,
      responderId: drop.ownerId,
      notes: textOrEmpty(body.notes, 1000, "notes_too_long"),
      status: "pending",
    });
    sendUserNotifications({
      recipientIds: [String(drop.ownerId)],
      sender: userId,
      title: "New Tap In",
      body: "Someone is interested in your Drop.",
      data: { type: "tap_in", objectType: "drop" },
      objectId: drop._id,
    });
    return toTapInView(created.toObject());
  } catch (err) {
    if (err && err.code === 11000) throw httpError(409, "tap_in_duplicate");
    throw err;
  }
}

async function withdrawTapIn(userId, tapInId) {
  const id = toObjectId(tapInId, "tap_in_not_found");
  const updated = await TapIn.findOneAndUpdate(
    { _id: id, requesterId: userId, status: "pending", deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { new: true },
  ).lean();
  if (updated) {
    sendUserNotifications({
      recipientIds: [String(updated.responderId)],
      sender: userId,
      title: "Tap In withdrawn",
      body: "A pending Tap In was withdrawn.",
      data: { type: "status_change", objectType: "tap_in" },
      objectId: updated._id,
    });
    return toTapInView(updated);
  }

  const existing = await TapIn.findById(id).lean();
  if (!existing) throw httpError(404, "tap_in_not_found");
  if (String(existing.requesterId) !== String(userId)) throw httpError(403, "access_denied");
  throw httpError(409, "invalid_status_transition");
}

async function declineTapIn(userId, tapInId) {
  const id = toObjectId(tapInId, "tap_in_not_found");
  const updated = await withTransaction(async (session) => {
    const updated = await TapIn.findOneAndUpdate(
      { _id: id, responderId: userId, status: "pending", deletedAt: null },
      { $set: { status: "declined" } },
      { new: true, session },
    ).lean();
    if (!updated) {
      const existing = await TapIn.findById(id).session(session).lean();
      if (!existing) throw httpError(404, "tap_in_not_found");
      if (String(existing.responderId) !== String(userId)) throw httpError(403, "access_denied");
      throw httpError(409, "invalid_status_transition");
    }
    await Drop.updateOne(
      { _id: updated.dropId, visibility: "direct", deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { session },
    );
    return updated;
  });
  sendUserNotifications({
    recipientIds: [String(updated.requesterId)],
    sender: userId,
    title: "Tap In declined",
    body: "Your Tap In was declined.",
    data: { type: "status_change", objectType: "tap_in" },
    objectId: updated._id,
  });
  return toTapInView(updated);
}

async function acceptTapIn(userId, tapInId) {
  const id = toObjectId(tapInId, "tap_in_not_found");
  const updated = await withTransaction(async (session) => {
    const accepted = await TapIn.findOneAndUpdate(
      { _id: id, responderId: userId, status: "pending", deletedAt: null },
      { $set: { status: "accepted" } },
      { new: true, session },
    ).lean();
    if (!accepted) {
      const existing = await TapIn.findById(id).session(session).lean();
      if (!existing) throw httpError(404, "tap_in_not_found");
      if (String(existing.responderId) !== String(userId)) throw httpError(403, "access_denied");
      throw httpError(409, "invalid_status_transition");
    }

    await assertTradeCapacity([accepted.responderId, accepted.requesterId], session, { selfId: userId });

    // Closing the drop first makes concurrent accepts on the same drop conflict
    const drop = await Drop.findOneAndUpdate(
      { _id: accepted.dropId, status: "open", deletedAt: null, ...dropExpiredFilter() },
      { $set: { status: "closed", closedAt: new Date() } },
      { new: true, session },
    ).lean();
    if (!drop) {
      const existing = await Drop.findById(accepted.dropId).session(session).lean();
      if (existing?.status === "open" && !existing.deletedAt && existing.expiresAt && existing.expiresAt <= new Date()) {
        throw httpError(409, "drop_expired");
      }
      throw httpError(409, "drop_not_open");
    }

    const pending = await TapIn.find(
      { dropId: accepted.dropId, _id: { $ne: accepted._id }, status: "pending", deletedAt: null },
      { requesterId: 1 },
    )
      .session(session)
      .lean();
    await TapIn.updateMany(
      { dropId: accepted.dropId, _id: { $ne: accepted._id }, status: "pending", deletedAt: null },
      {
        $set: {
          status: "closed",
          closedAt: new Date(),
          closureReason: "This Drop has closed, so your pending Tap In is no longer active.",
        },
      },
      { session },
    );

    const [trade] = await Trade.create(
      [
        {
          tapInId: accepted._id,
          dropId: accepted.dropId,
          dropOwnerId: drop.ownerId,
          kind: "collaboration",
          requesterId: accepted.requesterId,
          responderId: accepted.responderId,
          status: "active",
        },
      ],
      { session },
    );
    const [conversation] = await Conversation.create(
      [
        {
          type: "project",
          tradeId: trade._id,
          groupName: `Collaboration ${trade.tradeCode}`,
          participants: [
            { user: accepted.requesterId, role: "member", isActive: true },
            { user: accepted.responderId, role: "member", isActive: true },
          ],
          unreadCounts: {
            [String(accepted.requesterId)]: 0,
            [String(accepted.responderId)]: 0,
          },
        },
      ],
      { session },
    );
    trade.conversationId = conversation._id;
    await trade.save({ session });
    const linked = await TapIn.findByIdAndUpdate(
      accepted._id,
      { $set: { tradeId: trade._id } },
      { new: true, session },
    ).lean();
    return {
      tapIn: toTapInView(linked),
      trade: toTradeView(trade.toObject()),
      notificationRecipients: [...new Set(pending.map((item) => String(item.requesterId)))],
      acceptedRequesterId: String(accepted.requesterId),
      dropId: String(drop._id),
    };
  });
  sendUserNotifications({
    recipientIds: [result.acceptedRequesterId],
    sender: userId,
    title: "Collaboration accepted",
    body: "Your Tap In was accepted and a project chat is ready.",
    data: { type: "collaboration", objectType: "trade" },
    objectId: result.trade._id,
  });
  if (result.notificationRecipients.length) {
    await sendUserNotifications({
      recipientIds: result.notificationRecipients,
      title: "Drop closed",
      body: "This Drop has closed, so your pending Tap In is no longer active.",
      data: { type: "status_change", objectType: "drop" },
      objectId: result.dropId,
    });
  }
  delete result.notificationRecipients;
  delete result.acceptedRequesterId;
  delete result.dropId;
  return result;
}

async function listMyTapIns(userId, direction, req) {
  const { page, limit } = parsePaginationParams(req);
  const received = direction !== "sent" && direction !== "outgoing";
  const query = received ? { responderId: userId, deletedAt: null } : { requesterId: userId, deletedAt: null };
  if (req.query.status) query.status = String(req.query.status);

  const [items, total] = await Promise.all([
    TapIn.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    TapIn.countDocuments(query),
  ]);
  const [drops, users] = await Promise.all([
    Drop.find({ _id: { $in: items.map((t) => t.dropId) } })
      .populate("timingChip", "value label")
      .lean(),
    usersById(items.map((t) => (received ? t.requesterId : t.responderId))),
  ]);
  const dropMap = new Map(drops.map((d) => [String(d._id), d]));
  return {
    data: items.map((t) => ({
      ...toTapInView(t),
      drop: dropMap.has(String(t.dropId)) ? toDropView(dropMap.get(String(t.dropId)), userId) : null,
      counterparty: userBrief(users.get(String(received ? t.requesterId : t.responderId))),
    })),
    meta: generateMeta(page, limit, total),
  };
}

async function getTapIn(userId, tapInId) {
  const id = toObjectId(tapInId, "tap_in_not_found");
  const tapIn = await TapIn.findOne({ _id: id, deletedAt: null }).lean();
  if (!tapIn) throw httpError(404, "tap_in_not_found");
  if (String(tapIn.requesterId) !== String(userId) && String(tapIn.responderId) !== String(userId)) {
    throw httpError(403, "access_denied");
  }

  const [requester, collaborationCount, drop] = await Promise.all([
    User.findOne({ _id: tapIn.requesterId, deletedAt: null })
      .select("name handle profileIcon bio specialty areaLabel crafts")
      .populate("crafts", "name image")
      .lean(),
    Trade.countDocuments({
      kind: "collaboration",
      status: { $in: ["active", "completed"] },
      $or: [{ requesterId: tapIn.requesterId }, { responderId: tapIn.requesterId }],
    }),
    Drop.findById(tapIn.dropId).select("offerText needText status").lean(),
  ]);
  return {
    ...toTapInView(tapIn),
    dropId: drop
      ? { _id: idStr(drop._id), offerText: drop.offerText, needText: drop.needText, status: drop.status }
      : null,
    requester: requester
      ? {
          ...userBrief(requester),
          bio: requester.bio || "",
          specialty: requester.specialty || "",
          areaLabel: requester.areaLabel || "",
          crafts: (requester.crafts || []).filter(Boolean).map((craft) => ({
            _id: idStr(craft._id),
            name: craft.name,
            image: getFullImageUrl(craft.image),
          })),
          collaborationCount,
        }
      : null,
  };
}

async function getAllTapIns({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, status, dropId, requesterId, responderId, timingChip } = req.query;

  const baseMatch = { ...filter, deletedAt: null };
  const setId = (key, val) => {
    if (val && mongoose.isValidObjectId(val)) baseMatch[key] = new mongoose.Types.ObjectId(val);
  };
  setId("responderId", responderId);
  setId("requesterId", requesterId);
  setId("dropId", dropId);
  if (keyword?.trim()) {
    const regex = { $regex: escapeRegex(keyword.trim()), $options: "i" };
    baseMatch.$or = [{ notes: regex }];
  }

  let timingChipId = null;
  if (typeof timingChip === "string" && timingChip.trim()) {
    const v = timingChip.trim();
    if (mongoose.isValidObjectId(v)) timingChipId = new mongoose.Types.ObjectId(v);
    else timingChipId = (await TimingChip.findOne({ value: v.toLowerCase() }).select("_id").lean())?._id || null;
  }
  const timingChipMatch = timingChip ? [{ $match: { "drop.timingChip": timingChipId } }] : [];
  const statusMatch = status ? [{ $match: { status } }] : [];
  const userLookup = (localField, as) => ({
    $lookup: {
      from: "users",
      localField,
      foreignField: "_id",
      pipeline: [
        {
          $project: {
            _id: 1,
            name: 1,
            handle: 1,
            email: 1,
            profileIcon: { $concat: [process.env.S3_BASE_URL || "", "$profileIcon"] },
          },
        },
      ],
      as,
    },
  });

  const [result] = await TapIn.aggregate([
    { $match: baseMatch },
    {
      $lookup: {
        from: "drops",
        localField: "dropId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              ownerId: 1,
              ownerHandle: 1,
              kind: 1,
              visibility: 1,
              needText: 1,
              offerText: 1,
              needCategoryId: 1,
              offerCategoryId: 1,
              timingChip: 1,
              date: 1,
              areaLabel: 1,
            },
          },
        ],
        as: "drop",
      },
    },
    { $set: { drop: { $first: "$drop" } } },
    {
      $facet: {
        tapIns: [
          ...statusMatch,
          ...timingChipMatch,
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          userLookup("requesterId", "requester"),
          userLookup("responderId", "responder"),
          { $set: { requester: { $first: "$requester" }, responder: { $first: "$responder" } } },
        ],
        total: [...statusMatch, ...timingChipMatch, { $count: "count" }],
        counts: [...timingChipMatch, { $group: { _id: "$status", count: { $sum: 1 } } }],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;
  const counts = { pending: 0, accepted: 0, declined: 0 };
  (result?.counts || []).forEach(({ _id, count }) => {
    counts[_id] = count;
  });
  const [categories, chips] = await Promise.all([
    Category.find({}, { _id: 1, name: 1 }).lean(),
    TimingChip.find({}).sort({ sortOrder: 1 }).select("value label").lean(),
  ]);
  const meta = generateMeta(page, limit, total);
  meta.timingChips = [{ value: null, label: "All" }, ...chips];
  meta.categories = [{ _id: null, name: "All" }, ...categories];
  meta.counts = counts;
  return { data: result?.tapIns || [], meta };
}

module.exports = {
  sendDirect,
  tapIn,
  withdrawTapIn,
  declineTapIn,
  acceptTapIn,
  listMyTapIns,
  getTapIn,
  getAllTapIns,
};
