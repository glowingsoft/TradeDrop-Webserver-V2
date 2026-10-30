const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Drop } = require("@models/Drop");
const TapIn = require("@models/TapIn");
const Trade = require("@models/Trade");
const Category = require("@models/Category");
const TimingChip = require("@models/TimingChip");
const { User } = require("@UsersModel");
const { createActivity, activityTypes } = require("@helperUtils/activityUtil");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const { idStr, idStrOrNull, httpError } = require("../_shared/serialize");
const { DEFAULT_RADAR_RADIUS_KM } = require("../radar/radarConstants");
const {
  withTransaction,
  toObjectId,
  escapeRegex,
  publicDropFilter,
  toDropView,
  parseDropContent,
  parseExpiration,
  parseOptionalDate,
  parseLocationType,
  assertTimeRange,
  assertTradeCapacity,
  stringArray,
  loadOwner,
  dropExpiredFilter,
} = require("../_shared/tradeShared");

const OPEN_DROP_LIMIT = 2;
const DROP_CLOSED_NOTICE = "This Drop has closed, so your pending Tap In is no longer active.";

async function openDropIds(userId, session = null) {
  const query = Drop.find({
    ownerId: userId,
    status: "open",
    deletedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  }).select("_id");
  if (session) query.session(session);
  return (await query.lean()).map((drop) => idStr(drop._id));
}

async function parseDraftContent(body = {}, owner) {
  const content = {};
  const textFields = ["title", "needText", "offerText", "areaLabel", "idea"];
  for (const field of textFields) {
    if (body[field] === undefined) continue;
    const value = String(body[field]).trim();
    const maxLength = field === "title" ? 200 : field === "idea" ? 1000 : 2000;
    if (value.length > maxLength) throw httpError(400, `${field}_too_long`);
    content[field] = value;
  }
  for (const field of ["needCategoryId", "offerCategoryId"]) {
    if (body[field] === undefined || body[field] === "") continue;
    if (!mongoose.isValidObjectId(body[field])) throw httpError(400, "category_required");
    content[field] = new mongoose.Types.ObjectId(body[field]);
  }
  if (body.timingChip !== undefined && body.timingChip !== "") {
    const chip = await TimingChip.findOne({ value: String(body.timingChip).toLowerCase(), status: "active" })
      .select("_id")
      .lean();
    if (!chip) throw httpError(400, "timing_chip_invalid");
    content.timingChip = chip._id;
  }
  if (body.type !== undefined) {
    if (!["in_person", "remote"].includes(body.type)) throw httpError(400, "drop_type_invalid");
    content.type = body.type;
  }
  if (body.referenceImages !== undefined)
    content.referenceImages = stringArray(body.referenceImages, 10, "reference_images_invalid");
  if (body.locationType !== undefined) content.locationType = parseLocationType(body.locationType);
  if (body.expiresIn !== undefined || body.expiration !== undefined) {
    content.expiresAt = parseExpiration(body.expiresIn ?? body.expiration);
  }
  if (body.date !== undefined) {
    if (body.date && Number.isNaN(new Date(body.date).getTime())) throw httpError(400, "date_invalid");
    content.date = body.date ? new Date(body.date) : null;
  }
  if (body.startTime !== undefined) content.startTime = parseOptionalDate(body.startTime, "start_time_invalid");
  if (body.endTime !== undefined) content.endTime = parseOptionalDate(body.endTime, "end_time_invalid");
  if (content.startTime || content.endTime) assertTimeRange(content.startTime, content.endTime);

  if (body.type === "remote") {
    content.areaLabel = content.areaLabel || owner.areaLabel || "";
    content.lat = owner.lat ?? null;
    content.lng = owner.lng ?? null;
    content.location = owner.lat != null && owner.lng != null ? [Number(owner.lng), Number(owner.lat)] : undefined;
  } else if (body.lat !== undefined || body.lng !== undefined) {
    if (
      body.lat == null ||
      body.lng == null ||
      String(body.lat).trim() === "" ||
      String(body.lng).trim() === "" ||
      !Number.isFinite(Number(body.lat)) ||
      !Number.isFinite(Number(body.lng)) ||
      Number(body.lat) < -90 ||
      Number(body.lat) > 90 ||
      Number(body.lng) < -180 ||
      Number(body.lng) > 180
    ) {
      throw httpError(400, "location_invalid");
    }
    content.lat = Number(body.lat);
    content.lng = Number(body.lng);
    content.location = [content.lng, content.lat];
  }
  return content;
}

async function createDrop(userId, body = {}) {
  const owner = await loadOwner(userId);
  const requestedStatus = body.status || "draft";
  if (!["draft", "open", "publish"].includes(requestedStatus)) {
    throw httpError(400, "drop_status_invalid");
  }

  const draft = await parseDraftContent(body, owner);
  draft.type = body.type || "in_person";
  await assertNoDuplicateDrop(userId, draft);

  const [drop] = await Drop.create([
    {
      ...draft,
      ownerId: userId,
      ownerHandle: owner.handle || "",
      kind: "drop",
      visibility: "public",
      status: "draft",
    },
  ]);

  if (requestedStatus === "open" || requestedStatus === "publish") {
    return publishDrop(userId, drop._id);
  }

  return { drop: toDropView(drop.toObject(), userId), openDropIds: await openDropIds(userId) };
}

async function assertNoDuplicateDrop(userId, draft, session = null, excludeDropId = null) {
  if (!String(draft.needText || "").trim() || !String(draft.offerText || "").trim()) return;

  const query = Drop.findOne({
    ownerId: userId,
    needText: draft.needText,
    offerText: draft.offerText,
    status: { $in: ["draft", "open"] },
    deletedAt: null,
    ...(excludeDropId ? { _id: { $ne: excludeDropId } } : {}),
  });
  if (session) query.session(session);

  if (await query.lean()) {
    throw httpError(409, "drop_duplicate");
  }
}

function validateForPublishing(drop, owner, { allowExpired = false } = {}) {
  for (const field of ["title", "needText", "offerText"]) {
    if (!String(drop[field] || "").trim()) throw httpError(400, `${field}_required`);
  }
  if (!mongoose.isValidObjectId(drop.needCategoryId) || !mongoose.isValidObjectId(drop.offerCategoryId)) {
    throw httpError(400, "category_required");
  }
  if (drop.type === "remote") {
    if (owner.lat == null || owner.lng == null) throw httpError(400, "owner_location_required");
    drop.areaLabel = owner.areaLabel || drop.areaLabel;
    drop.lat = Number(owner.lat);
    drop.lng = Number(owner.lng);
    drop.location = [drop.lng, drop.lat];
  } else if (drop.type === "in_person") {
    if (!String(drop.areaLabel || "").trim()) throw httpError(400, "meeting_location_required");
  } else {
    throw httpError(400, "drop_type_invalid");
  }
  if (!allowExpired && drop.expiresAt && drop.expiresAt <= new Date()) throw httpError(400, "expiration_invalid");
}

async function publishDrop(userId, dropId) {
  const id = toObjectId(dropId, "drop_not_found");
  const owner = await loadOwner(userId);
  return withTransaction(async (session) => {
    const drop = await Drop.findOne({ _id: id, ownerId: userId, deletedAt: null }).session(session);
    if (!drop) throw httpError(404, "drop_not_found");
    if (drop.status === "open") {
      if (drop.expiresAt && drop.expiresAt <= new Date()) throw httpError(409, "drop_expired");
      return { published: true, drop: toDropView(drop.toObject(), userId) };
    }
    if (drop.status !== "draft") throw httpError(409, "invalid_status_transition");

    validateForPublishing(drop, owner);
    await assertNoDuplicateDrop(userId, drop, session, drop._id);
    await User.updateOne({ _id: userId }, { $inc: { tradeLock: 1 } }, { session, timestamps: false });
    const existing = await openDropIds(userId, session);
    if (existing.length >= OPEN_DROP_LIMIT) {
      return {
        published: false,
        reason: "open_drop_limit",
        openDropIds: existing,
        drop: toDropView(drop.toObject(), userId),
      };
    }

    drop.status = "open";
    drop.publishedAt = new Date();
    drop.closedAt = null;
    await drop.save({ session });
    return {
      published: true,
      openDropIds: [...existing, idStr(drop._id)],
      drop: toDropView(drop.toObject(), userId),
    };
  });
}

async function closeDrop(userId, dropId) {
  const id = toObjectId(dropId, "drop_not_found");
  const result = await withTransaction(async (session) => {
    const drop = await Drop.findOneAndUpdate(
      { _id: id, ownerId: userId, status: { $in: ["draft", "open"] }, deletedAt: null },
      { $set: { status: "closed", closedAt: new Date() } },
      { new: true, session },
    ).lean();
    if (!drop) {
      const current = await Drop.findById(id).session(session).lean();
      if (!current || current.deletedAt) throw httpError(404, "drop_not_found");
      if (String(current.ownerId) !== String(userId)) throw httpError(403, "access_denied");
      if (["closed", "expired"].includes(current.status)) {
        return { drop: current, recipientIds: [] };
      }
      throw httpError(409, "invalid_status_transition");
    }
    const pending = await TapIn.find({ dropId: id, status: "pending", deletedAt: null })
      .select("requesterId")
      .session(session)
      .lean();
    await TapIn.updateMany(
      { dropId: id, status: "pending", deletedAt: null },
      { $set: { status: "closed", closedAt: new Date(), closureReason: DROP_CLOSED_NOTICE } },
      { session },
    );
    return { drop, recipientIds: [...new Set(pending.map((item) => String(item.requesterId)))] };
  });
  if (result.recipientIds.length) {
    await sendUserNotifications({
      recipientIds: result.recipientIds,
      title: "Drop closed",
      body: DROP_CLOSED_NOTICE,
      data: { type: "status_change", objectType: "drop" },
      objectId: result.drop._id,
    });
  }
  return { closed: true, drop: toDropView(result.drop, userId) };
}

async function expireDrops(now = new Date(), batchSize = 100) {
  const result = await withTransaction(async (session) => {
    const expired = await Drop.find({
      status: "open",
      deletedAt: null,
      expiresAt: { $ne: null, $lte: now },
    })
      .select("_id")
      .limit(batchSize)
      .session(session)
      .lean();
    const dropIds = expired.map((drop) => drop._id);
    if (!dropIds.length) return { count: 0, recipientIds: [] };
    const pending = await TapIn.find({ dropId: { $in: dropIds }, status: "pending", deletedAt: null })
      .select("dropId requesterId")
      .session(session)
      .lean();
    await Drop.updateMany(
      { _id: { $in: dropIds }, status: "open", deletedAt: null, expiresAt: { $lte: now } },
      { $set: { status: "expired", closedAt: now } },
      { session },
    );
    await TapIn.updateMany(
      { dropId: { $in: dropIds }, status: "pending", deletedAt: null },
      { $set: { status: "closed", closedAt: now, closureReason: DROP_CLOSED_NOTICE } },
      { session },
    );
    return {
      count: dropIds.length,
      recipientsByDrop: pending.reduce((groups, item) => {
        const key = String(item.dropId);
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(String(item.requesterId));
        return groups;
      }, new Map()),
    };
  });
  for (const [dropId, recipients] of result.recipientsByDrop || []) {
    await sendUserNotifications({
      recipientIds: [...recipients],
      title: "Drop expired",
      body: DROP_CLOSED_NOTICE,
      data: { type: "status_change", objectType: "drop" },
      objectId: dropId,
    });
  }
  return { expiredCount: result.count };
}

async function reopenDrop(userId, dropId) {
  const id = toObjectId(dropId, "drop_not_found");
  const owner = await loadOwner(userId);
  return withTransaction(async (session) => {
    const drop = await Drop.findOne({ _id: id, ownerId: userId, deletedAt: null }).session(session);
    if (!drop) throw httpError(404, "drop_not_found");
    const alreadyExpired = drop.status === "open" && drop.expiresAt && drop.expiresAt <= new Date();
    if (!["closed", "expired"].includes(drop.status) && !alreadyExpired) {
      throw httpError(409, "invalid_status_transition");
    }
    if (drop.visibility !== "public") throw httpError(409, "invalid_status_transition");
    validateForPublishing(drop, owner, { allowExpired: true });
    await User.updateOne({ _id: userId }, { $inc: { tradeLock: 1 } }, { session, timestamps: false });
    const existing = await openDropIds(userId, session);
    if (existing.length >= OPEN_DROP_LIMIT) {
      return {
        reopened: false,
        reason: "open_drop_limit",
        openDropIds: existing,
        drop: toDropView(drop.toObject(), userId),
      };
    }
    drop.status = "open";
    drop.publishedAt = new Date();
    drop.closedAt = null;
    drop.expiresAt = new Date(Date.now() + 7 * 86400000);
    await drop.save({ session });
    return { reopened: true, openDropIds: [...existing, idStr(drop._id)], drop: toDropView(drop.toObject(), userId) };
  });
}

async function extendDrop(userId, dropId) {
  const id = toObjectId(dropId, "drop_not_found");
  const now = new Date();
  const drop = await Drop.findOne({ _id: id, ownerId: userId, deletedAt: null });
  if (!drop) throw httpError(404, "drop_not_found");
  if (
    drop.status === "closed" ||
    drop.status === "expired" ||
    (drop.status === "open" && drop.expiresAt && drop.expiresAt <= now)
  ) {
    return reopenDrop(userId, dropId);
  }
  if (drop.status !== "open") throw httpError(409, "invalid_status_transition");
  drop.expiresAt = new Date(now.getTime() + 7 * 86400000);
  await drop.save();
  return { extended: true, drop: toDropView(drop.toObject(), userId) };
}

async function patchDrop(userId, dropId, body = {}) {
  const id = toObjectId(dropId, "drop_not_found");
  const set = {};
  const unset = {};

  const required = {
    needText: "need_text_required",
    offerText: "offer_text_required",
    areaLabel: "area_label_required",
  };
  for (const [field, key] of Object.entries(required)) {
    if (body[field] === undefined) continue;
    if (!String(body[field]).trim()) throw httpError(400, key);
    set[field] = String(body[field]).trim();
  }
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) throw httpError(400, "title_required");
    if (title.length > 120) throw httpError(400, "title_too_long");
    set.title = title;
  }
  if (body.locationType !== undefined) set.locationType = parseLocationType(body.locationType || undefined);
  if (body.type !== undefined) {
    if (!["in_person", "remote"].includes(body.type)) throw httpError(400, "drop_type_invalid");
    set.type = body.type;
    if (body.type === "remote") {
      const owner = await loadOwner(userId);
      set.areaLabel = owner.areaLabel || "";
      set.lat = owner.lat ?? null;
      set.lng = owner.lng ?? null;
      if (owner.lat != null && owner.lng != null) set.location = [Number(owner.lng), Number(owner.lat)];
      else unset.location = "";
    }
  }
  if (body.referenceImages !== undefined) {
    set.referenceImages = stringArray(body.referenceImages, 10, "reference_images_invalid");
  }
  if (body.expiresIn !== undefined || body.expiration !== undefined) {
    set.expiresAt = parseExpiration(body.expiresIn ?? body.expiration);
  }
  if (body.startTime !== undefined || body.endTime !== undefined) {
    const current = await Drop.findById(id).select("startTime endTime").lean();
    const startTime =
      body.startTime !== undefined ? parseOptionalDate(body.startTime, "start_time_invalid") : current?.startTime;
    const endTime = body.endTime !== undefined ? parseOptionalDate(body.endTime, "end_time_invalid") : current?.endTime;
    assertTimeRange(startTime, endTime);
    if (body.startTime !== undefined) set.startTime = startTime;
    if (body.endTime !== undefined) set.endTime = endTime;
  }
  if (body.idea !== undefined) {
    if (String(body.idea).length > 500) throw httpError(400, "idea_too_long");
    set.idea = String(body.idea);
  }
  for (const f of ["needCategoryId", "offerCategoryId"]) {
    if (body[f] === undefined) continue;
    if (!mongoose.isValidObjectId(body[f])) throw httpError(400, "category_required");
    set[f] = String(body[f]);
  }
  if (body.timingChip !== undefined) {
    const chip = await TimingChip.findOne({ value: String(body.timingChip).toLowerCase(), status: "active" }).lean();
    if (!chip) throw httpError(400, "timing_chip_invalid");
    set.timingChip = chip._id;
  }
  if (body.date !== undefined) {
    if (body.date && Number.isNaN(new Date(body.date).getTime())) throw httpError(400, "date_invalid");
    set.date = body.date ? new Date(body.date) : null;
  }
  if (body.lat !== undefined || body.lng !== undefined) {
    if (body.lat == null || body.lng == null || Number.isNaN(Number(body.lat)) || Number.isNaN(Number(body.lng))) {
      set.lat = null;
      set.lng = null;
      unset.location = "";
    } else {
      set.lat = Number(body.lat);
      set.lng = Number(body.lng);
      set.location = [set.lng, set.lat];
    }
  }

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;

  const filter = { _id: id, ownerId: userId, status: { $in: ["draft", "open"] }, deletedAt: null };
  const updated = Object.keys(update).length
    ? await Drop.findOneAndUpdate(filter, update, { new: true, runValidators: true })
        .populate("timingChip", "value label")
        .lean()
    : await Drop.findOne(filter).populate("timingChip", "value label").lean();
  if (updated) return toDropView(updated, userId);

  const drop = await Drop.findById(id).lean();
  if (!drop || drop.deletedAt) throw httpError(404, "drop_not_found");
  if (String(drop.ownerId) !== String(userId)) throw httpError(403, "access_denied");
  throw httpError(409, "invalid_status_transition");
}

async function deleteDrop(userId, dropId) {
  const id = toObjectId(dropId, "drop_not_found");
  const result = await withTransaction(async (session) => {
    const drop = await Drop.findOneAndUpdate(
      { _id: id, ownerId: userId, status: { $in: ["draft", "open"] }, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true, session },
    ).lean();
    if (!drop) {
      const existing = await Drop.findById(id).session(session).lean();
      if (!existing || existing.deletedAt) throw httpError(404, "drop_not_found");
      if (String(existing.ownerId) !== String(userId)) throw httpError(403, "access_denied");
      throw httpError(409, "invalid_status_transition");
    }
    const pending = await TapIn.find({ dropId: id, status: "pending", deletedAt: null })
      .select("requesterId")
      .session(session)
      .lean();
    await TapIn.updateMany(
      { dropId: id, status: "pending", deletedAt: null },
      {
        $set: {
          status: "closed",
          closedAt: new Date(),
          closureReason: DROP_CLOSED_NOTICE,
        },
      },
      { session },
    );
    return {
      deleted: true,
      _id: idStr(drop._id),
      recipientIds: [...new Set(pending.map((item) => String(item.requesterId)))],
    };
  });
  if (result.recipientIds.length) {
    await sendUserNotifications({
      recipientIds: result.recipientIds,
      title: "Drop closed",
      body: DROP_CLOSED_NOTICE,
      data: { type: "status_change", objectType: "drop" },
      objectId: result._id,
    });
  }
  delete result.recipientIds;
  return result;
}

async function getDrop(dropId, viewerId = null) {
  const id = toObjectId(dropId, "drop_not_found");
  const drop = await Drop.findOne({ _id: id, deletedAt: null }).populate("timingChip", "value label").lean();
  if (!drop) throw httpError(404, "drop_not_found");

  if (drop.status === "draft" && (!viewerId || String(viewerId) !== String(drop.ownerId))) {
    throw httpError(404, "drop_not_found");
  }
  if (drop.visibility === "direct") {
    const allowed =
      viewerId && (String(viewerId) === String(drop.ownerId) || String(viewerId) === String(drop.targetUserId));
    if (!allowed) throw httpError(404, "drop_not_found");
  }
  const trade = await Trade.findOne({ dropId: id, status: { $in: ["active", "completed"] } })
    .select("status")
    .lean();
  return toDropView(drop, viewerId, { trade });
}

async function listPublic(req, viewerId = null) {
  const { page, limit } = parsePaginationParams(req);
  const { category, area, timing } = req.query;
  const filter = publicDropFilter();
  if (req.query.status === "ended") {
    delete filter.status;
    delete filter.$or;
    filter.$or = [
      { status: "closed" },
      { status: "expired" },
      { status: "open", expiresAt: { $ne: null, $lte: new Date() } },
    ];
  }
  const and = [];
  if (category && mongoose.isValidObjectId(category)) {
    and.push({ $or: [{ needCategoryId: category }, { offerCategoryId: category }] });
  }
  if (area) filter.areaLabel = String(area);
  if (timing) {
    const chip = await TimingChip.findOne({ value: String(timing).toLowerCase() })
      .select("_id")
      .lean();
    filter.timingChip = chip ? chip._id : null;
  }
  const query = and.length ? { $and: [filter, ...and] } : filter;

  const [items, total] = await Promise.all([
    Drop.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("timingChip", "value label")
      .lean(),
    Drop.countDocuments(query),
  ]);
  return { data: items.map((d) => toDropView(d, viewerId)), meta: generateMeta(page, limit, total) };
}

async function listMyDrops(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const query = { ownerId: userId, deletedAt: null };
  const status = String(req.query.status || "open");
  if (status === "ended") {
    query.$or = [
      { status: { $in: ["closed", "expired"] } },
      { status: "open", expiresAt: { $ne: null, $lte: new Date() } },
    ];
  } else if (["draft", "open", "closed", "expired"].includes(status)) {
    query.status = status;
    if (status === "open") Object.assign(query, dropExpiredFilter());
  } else throw httpError(400, "drop_status_invalid");
  const [items, total] = await Promise.all([
    Drop.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("timingChip", "value label")
      .lean(),
    Drop.countDocuments(query),
  ]);
  const trades = await Trade.find({
    dropId: { $in: items.map((d) => d._id) },
    status: { $in: ["active", "completed"] },
  })
    .select("dropId status")
    .lean();
  const tradeByDrop = new Map(trades.map((t) => [String(t.dropId), t]));
  return {
    data: items.map((d) => toDropView(d, userId, { trade: tradeByDrop.get(String(d._id)) })),
    meta: generateMeta(page, limit, total),
  };
}

async function getAllDrops(req, { extraConditions = [] } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const {
    keyword,
    needCategoryId,
    offerCategoryId,
    categories: requestedCategoriesParam,
    areaLabel,
    ownerId,
    timingChip,
    lat,
    lng,
    radius,
    tag,
    notme,
    kind,
    type,
    date,
  } = req.query;

  const match = publicDropFilter();
  const and = [...extraConditions];
  if (notme === "true" && req.user?._id) match.ownerId = { $ne: new mongoose.Types.ObjectId(req.user._id) };
  if (needCategoryId && mongoose.isValidObjectId(needCategoryId)) {
    match.needCategoryId = new mongoose.Types.ObjectId(needCategoryId);
  }
  if (offerCategoryId && mongoose.isValidObjectId(offerCategoryId)) {
    match.offerCategoryId = new mongoose.Types.ObjectId(offerCategoryId);
  }
  if (areaLabel) match.areaLabel = areaLabel;
  if (ownerId && mongoose.isValidObjectId(ownerId)) match.ownerId = new mongoose.Types.ObjectId(ownerId);
  if (timingChip && mongoose.isValidObjectId(timingChip)) match.timingChip = new mongoose.Types.ObjectId(timingChip);
  if (kind) match.kind = String(kind);
  if (type && type !== "any") {
    if (!["in_person", "remote"].includes(String(type))) throw httpError(400, "drop_type_invalid");
    match.type = String(type);
  }
  if (tag === "isNew") {
    match.status = "open";
    Object.assign(match, dropExpiredFilter());
  }
  if (requestedCategoriesParam) {
    const categoryIds = (
      Array.isArray(requestedCategoriesParam) ? requestedCategoriesParam : String(requestedCategoriesParam).split(",")
    )
      .map((value) => String(value).trim())
      .filter((value) => mongoose.isValidObjectId(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    if (!categoryIds.length) throw httpError(400, "category_required");
    and.push({ $or: [{ needCategoryId: { $in: categoryIds } }, { offerCategoryId: { $in: categoryIds } }] });
  }
  if (date && date !== "anytime") {
    const now = new Date();
    const end = new Date(now);
    if (date === "next7days" || date === "next7dys") {
      end.setDate(end.getDate() + 7);
    } else if (date === "next30days") {
      end.setDate(end.getDate() + 30);
    } else {
      throw httpError(400, "drop_date_filter_invalid");
    }
    match.date = { $gte: now, $lte: end };
  }
  if (keyword?.trim()) {
    const regex = { $regex: escapeRegex(keyword.trim()), $options: "i" };
    and.push({
      $or: [{ title: regex }, { needText: regex }, { offerText: regex }, { idea: regex }, { ownerHandle: regex }],
    });
  }
  if (tag === "today") {
    const tz = req.user?.timezone || "UTC";
    match.createdAt = { $gte: moment.tz(tz).startOf("day").toDate(), $lte: moment.tz(tz).endOf("day").toDate() };
  }
  const query = and.length ? { $and: [match, ...and] } : match;

  if ((lat == null) !== (lng == null)) throw httpError(400, "location_invalid");
  if (
    lat != null &&
    (String(lat).trim() === "" ||
      String(lng).trim() === "" ||
      !Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lng)) ||
      Number(lat) < -90 ||
      Number(lat) > 90 ||
      Number(lng) < -180 ||
      Number(lng) > 180)
  ) {
    throw httpError(400, "location_invalid");
  }
  if (radius !== undefined && (!Number.isFinite(Number(radius)) || Number(radius) <= 0)) {
    throw httpError(400, "radius_invalid");
  }
  const hasGeo = (tag === "near_me" && req.user?.lat != null && req.user?.lng != null) || (lat != null && lng != null);
  const viewerLat = req.user?.lat ?? Number(lat);
  const viewerLng = req.user?.lng ?? Number(lng);
  const head = hasGeo
    ? [
        {
          $geoNear: {
            near: { type: "Point", coordinates: [viewerLng, viewerLat] },
            key: "location",
            distanceField: "distanceMeters",
            maxDistance: (Number(radius) || DEFAULT_RADAR_RADIUS_KM) * 1000,
            spherical: true,
            query,
          },
        },
      ]
    : [{ $match: query }];

  const brief = (from, localField, as, project) => ({
    $lookup: { from, localField, foreignField: "_id", pipeline: [{ $project: project }], as },
  });

  const [result] = await Drop.aggregate([
    ...head,
    {
      $facet: {
        drops: [
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          brief("categories", "needCategoryId", "needCategory", { name: 1, image: 1 }),
          brief("categories", "offerCategoryId", "offerCategory", { name: 1, image: 1 }),
          brief("users", "ownerId", "owner", {
            name: 1,
            handle: 1,
            profileIcon: { $concat: [process.env.S3_BASE_URL || "", "$profileIcon"] },
          }),
          brief("timingchips", "timingChip", "timingChipDetails", { value: 1, label: 1 }),
          {
            $set: {
              needCategory: { $first: "$needCategory" },
              offerCategory: { $first: "$offerCategory" },
              owner: { $first: "$owner" },
              timingChip: { $first: "$timingChipDetails" },
              referenceImages: {
                $map: {
                  input: { $ifNull: ["$referenceImages", []] },
                  as: "img",
                  in: {
                    $cond: [
                      { $regexMatch: { input: "$$img", regex: /^http/ } },
                      "$$img",
                      { $concat: [process.env.S3_BASE_URL || "", "$$img"] },
                    ],
                  },
                },
              },
            },
          },
          {
            $project: {
              title: 1,
              type: 1,
              locationType: 1,
              referenceImages: 1,
              startTime: 1,
              endTime: 1,
              expiresAt: 1,
              ownerId: 1,
              ownerHandle: 1,
              owner: 1,
              kind: 1,
              needText: 1,
              offerText: 1,
              needCategoryId: 1,
              offerCategoryId: 1,
              needCategory: 1,
              offerCategory: 1,
              timingChip: 1,
              date: 1,
              areaLabel: 1,
              lat: 1,
              lng: 1,
              idea: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              distanceMeters: 1,
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;
  const [categories, chips, areas] = await Promise.all([
    Category.find({ status: "active" }, { _id: 1, name: 1 }).lean(),
    TimingChip.find({ status: "active" }).sort({ sortOrder: 1 }).select("_id value label").lean(),
    Drop.distinct("areaLabel", { ...publicDropFilter(), areaLabel: { $nin: [null, ""] } }),
  ]);
  const meta = generateMeta(page, limit, total);
  meta.timingChips = [
    { value: null, label: "All" },
    ...chips.map((c) => ({ _id: c._id, value: c.value, label: c.label })),
  ];
  meta.areas = [{ value: null, label: "All" }, ...areas.map((v) => ({ label: v, value: v }))];
  meta.categories = [{ _id: null, name: "All" }, ...categories];

  const drops = result?.drops?.map((drop) => toDropView(drop)) || [];

  return { data: drops, meta };
}

module.exports = {
  createDrop,
  publishDrop,
  closeDrop,
  reopenDrop,
  extendDrop,
  expireDrops,
  patchDrop,
  deleteDrop,
  getDrop,
  listPublic,
  listMyDrops,
  getAllDrops,
};
