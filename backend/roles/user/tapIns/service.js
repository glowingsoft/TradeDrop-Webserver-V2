const mongoose = require("mongoose");
const { User } = require("@UsersModel");
const { Drop } = require("@models/Drop");
const TapIn = require("@models/TapIn");
const Trade = require("@models/Trade");
const Category = require("@models/Category");
const TimingChip = require("@models/TimingChip");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { isBlockedBetween, isActivelyConnected, recordCompletedTrade } = require("@helperUtils/connectionUtil");
const { idStr, idStrOrNull, httpError } = require("../_shared/serialize");
const {
  withTransaction,
  toObjectId,
  escapeRegex,
  publicDropFilter,
  assertTradeCapacity,
  dropExpiredFilter,
  textOrEmpty,
  stringArray,
  userBrief,
  usersById,
  toDropView,
  toTapInView,
  toTradeView,
  parseDropContent,
  loadOwner,
  DIRECT_AVAILABILITY,
  DIRECT_KINDS,
} = require("../_shared/tradeShared");

async function sendDirect(kind, userId, targetUserId, body = {}) {
  if (!DIRECT_KINDS.includes(kind)) throw httpError(400, "invalid_kind");
  const targetId = toObjectId(targetUserId, "user_not_found");
  if (String(targetId) === String(userId)) throw httpError(400, "cannot_target_self");

  const [owner, target, content] = await Promise.all([
    loadOwner(userId),
    User.findById(targetId).select("_id deletedAt").lean(),
    parseDropContent(body),
  ]);
  if (!target || target.deletedAt) throw httpError(404, "user_not_found");
  if (await isBlockedBetween(userId, targetId)) throw httpError(403, "user_blocked");
  if (kind === "collaboration" && !(await isActivelyConnected(userId, targetId))) {
    throw httpError(403, "connection_required");
  }

  return withTransaction(async (session) => {
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
          yourOffer: drop.offerText,
          availability: DIRECT_AVAILABILITY,
          link: textOrEmpty(body.link, 500, "link_too_long"),
          note: textOrEmpty(body.note, 1000, "note_too_long"),
          media: stringArray(body.media, 10, "media_invalid"),
          status: "pending",
        },
      ],
      { session },
    );
    return { drop: toDropView(drop.toObject(), userId), tapIn: toTapInView(created.toObject()) };
  });
}


async function tapIn(userId, dropId, body = {}) {
  const id = toObjectId(dropId, "drop_not_found");
  const drop = await Drop.findOne({ _id: id, ...publicDropFilter() }).lean();
  if (!drop) throw httpError(404, "drop_not_found");
  if (drop.expiresAt && new Date(drop.expiresAt) <= new Date()) throw httpError(409, "drop_expired");
  if (String(drop.ownerId) === String(userId)) throw httpError(403, "cannot_tap_own_drop");
  if (await isBlockedBetween(userId, drop.ownerId)) throw httpError(403, "user_blocked");

  const yourOffer = textOrEmpty(body.yourOffer, 1000, "your_offer_too_long");
  const availability = textOrEmpty(body.availability, 300, "availability_too_long");
  if (!yourOffer) throw httpError(400, "your_offer_required");
  if (!availability) throw httpError(400, "availability_required");

  try {
    const created = await TapIn.create({
      dropId: drop._id,
      requesterId: userId,
      responderId: drop.ownerId,
      yourOffer,
      availability,
      link: textOrEmpty(body.link, 500, "link_too_long"),
      note: textOrEmpty(body.note, 1000, "note_too_long"),
      media: stringArray(body.media, 10, "media_invalid"),
      status: "pending",
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
  if (updated) return toTapInView(updated);

  const existing = await TapIn.findById(id).lean();
  if (!existing) throw httpError(404, "tap_in_not_found");
  if (String(existing.requesterId) !== String(userId)) throw httpError(403, "access_denied");
  throw httpError(409, "invalid_status_transition");
}

async function declineTapIn(userId, tapInId) {
  const id = toObjectId(tapInId, "tap_in_not_found");
  return withTransaction(async (session) => {
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
    return toTapInView(updated);
  });
}

async function acceptTapIn(userId, tapInId) {
  const id = toObjectId(tapInId, "tap_in_not_found");
  return withTransaction(async (session) => {
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
      { $set: { status: "closed" } },
      { new: true, session },
    ).lean();
    if (!drop) {
      const existing = await Drop.findById(accepted.dropId).session(session).lean();
      if (existing?.status === "open" && !existing.deletedAt && existing.expiresAt && existing.expiresAt <= new Date()) {
        throw httpError(409, "drop_expired");
      }
      throw httpError(409, "drop_not_open");
    }

    await TapIn.updateMany(
      { dropId: accepted.dropId, _id: { $ne: accepted._id }, status: "pending", deletedAt: null },
      { $set: { status: "declined" } },
      { session },
    );

    const [trade] = await Trade.create(
      [
        {
          tapInId: accepted._id,
          dropId: accepted.dropId,
          dropOwnerId: drop.ownerId,
          kind: drop.kind,
          requesterId: accepted.requesterId,
          responderId: accepted.responderId,
          status: "active",
        },
      ],
      { session },
    );
    const linked = await TapIn.findByIdAndUpdate(
      accepted._id,
      { $set: { tradeId: trade._id } },
      { new: true, session },
    ).lean();
    return { tapIn: toTapInView(linked), trade: toTradeView(trade.toObject()) };
  });
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
    baseMatch.$or = [{ yourOffer: regex }, { availability: regex }, { link: regex }, { note: regex }];
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
  getAllTapIns,
};
