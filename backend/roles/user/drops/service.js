const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Drop } = require("@models/Drop");
const TapIn = require("@models/TapIn");
const Trade = require("@models/Trade");
const Category = require("@models/Category");
const TimingChip = require("@models/TimingChip");
const { createActivity, activityTypes } = require("@helperUtils/activityUtil");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
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
} = require("../_shared/tradeShared");

async function createDrop(userId, body = {}) {
  const [owner, content] = await Promise.all([loadOwner(userId), parseDropContent(body)]);

  const duplicate = await Drop.exists({
    ownerId: userId,
    ...publicDropFilter(),
    needCategoryId: content.needCategoryId,
    offerCategoryId: content.offerCategoryId,
  });
  if (duplicate) throw httpError(409, "drop_already_exists");

  const drop = await withTransaction(async (session) => {
    await assertTradeCapacity([userId], session);
    const [created] = await Drop.create(
      [
        {
          ...content,
          ownerId: userId,
          ownerHandle: owner.handle || "",
          kind: "drop",
          visibility: "public",
          status: "open",
        },
      ],
      { session },
    );
    return created;
  });

  await createActivity({ type: activityTypes.NEW_DROP, user: userId, drop: drop._id }).catch(() => null);
  return toDropView(drop.toObject(), userId);
}

async function patchDrop(userId, dropId, body = {}) {
  const id = toObjectId(dropId, "drop_not_found");
  const set = {};
  const unset = {};

  const required = { needText: "need_text_required", offerText: "offer_text_required", areaLabel: "area_label_required" };
  for (const [field, key] of Object.entries(required)) {
    if (body[field] === undefined) continue;
    if (!String(body[field]).trim()) throw httpError(400, key);
    set[field] = String(body[field]).trim();
  }
  if (body.concept !== undefined) {
    const concept = String(body.concept).trim();
    if (!concept) throw httpError(400, "concept_required");
    if (concept.length > 120) throw httpError(400, "concept_too_long");
    set.concept = concept;
  }
  if (body.locationType !== undefined) set.locationType = parseLocationType(body.locationType || undefined);
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
  if (body.detail !== undefined) {
    if (String(body.detail).length > 500) throw httpError(400, "detail_too_long");
    set.detail = String(body.detail);
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

  const filter = { _id: id, ownerId: userId, status: "open", deletedAt: null };
  const updated = Object.keys(update).length
    ? await Drop.findOneAndUpdate(filter, update, { new: true }).populate("timingChip", "value label").lean()
    : await Drop.findOne(filter).populate("timingChip", "value label").lean();
  if (updated) return toDropView(updated, userId);

  const drop = await Drop.findById(id).lean();
  if (!drop || drop.deletedAt) throw httpError(404, "drop_not_found");
  if (String(drop.ownerId) !== String(userId)) throw httpError(403, "access_denied");
  throw httpError(409, "invalid_status_transition");
}

async function deleteDrop(userId, dropId) {
  const id = toObjectId(dropId, "drop_not_found");
  return withTransaction(async (session) => {
    const drop = await Drop.findOneAndUpdate(
      { _id: id, ownerId: userId, status: "open", deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true, session },
    ).lean();
    if (!drop) {
      const existing = await Drop.findById(id).session(session).lean();
      if (!existing || existing.deletedAt) throw httpError(404, "drop_not_found");
      if (String(existing.ownerId) !== String(userId)) throw httpError(403, "access_denied");
      throw httpError(409, "invalid_status_transition");
    }
    await TapIn.updateMany(
      { dropId: id, status: "pending", deletedAt: null },
      { $set: { status: "declined" } },
      { session },
    );
    return { deleted: true, _id: idStr(drop._id) };
  });
}

async function getDrop(dropId, viewerId = null) {
  const id = toObjectId(dropId, "drop_not_found");
  const drop = await Drop.findOne({ _id: id, deletedAt: null }).populate("timingChip", "value label").lean();
  if (!drop) throw httpError(404, "drop_not_found");

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
  const and = [];
  if (category && mongoose.isValidObjectId(category)) {
    and.push({ $or: [{ needCategoryId: category }, { offerCategoryId: category }] });
  }
  if (area) filter.areaLabel = String(area);
  if (timing) {
    const chip = await TimingChip.findOne({ value: String(timing).toLowerCase() }).select("_id").lean();
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
  const [items, total] = await Promise.all([
    Drop.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("timingChip", "value label")
      .lean(),
    Drop.countDocuments(query),
  ]);
  const trades = await Trade.find({ dropId: { $in: items.map((d) => d._id) }, status: { $in: ["active", "completed"] } })
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
  const { keyword, needCategoryId, offerCategoryId, areaLabel, ownerId, timingChip, lat, lng, tag, notme, kind } =
    req.query;

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
  if (keyword?.trim()) {
    const regex = { $regex: escapeRegex(keyword.trim()), $options: "i" };
    and.push({ $or: [{ needText: regex }, { offerText: regex }, { detail: regex }, { ownerHandle: regex }] });
  }
  if (tag === "today") {
    const tz = req.user?.timezone || "UTC";
    match.createdAt = { $gte: moment.tz(tz).startOf("day").toDate(), $lte: moment.tz(tz).endOf("day").toDate() };
  }
  const query = and.length ? { $and: [match, ...and] } : match;

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
            maxDistance: DEFAULT_RADAR_RADIUS_KM * 1000,
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
              concept: 1,
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
              detail: 1,
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
    Category.find({ active: true }, { _id: 1, name: 1 }).lean(),
    TimingChip.find({ status: "active" }).sort({ sortOrder: 1 }).select("value label").lean(),
    Drop.distinct("areaLabel", { ...publicDropFilter(), areaLabel: { $nin: [null, ""] } }),
  ]);
  const meta = generateMeta(page, limit, total);
  meta.timingChips = [{ value: null, label: "All" }, ...chips.map((c) => ({ _id: c._id, value: c.value, label: c.label }))];
  meta.areas = [{ value: null, label: "All" }, ...areas.map((v) => ({ label: v, value: v }))];
  meta.categories = [{ _id: null, name: "All" }, ...categories];

  return { data: result?.drops || [], meta };
}

module.exports = {
  createDrop,
  patchDrop,
  deleteDrop,
  getDrop,
  listPublic,
  listMyDrops,
  getAllDrops,
};
