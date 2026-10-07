const mongoose = require("mongoose");
const moment = require("moment-timezone");
const repo = require("./dropRepository");
const authRepo = require("../auth/authRepository");
const timingChipRepo = require("../catalog/timingChipRepository");
const { createActivity, activityTypes } = require("@helperUtils/activityUtil");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { Drop } = require("@models/Drop");
const Category = require("@models/Category");
const { DEFAULT_RADAR_RADIUS_KM } = require("../radar/radarConstants");
const tapInService = require("../tapIns/tapInService");

function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

async function requireUser(userId) {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) throw AppError("account_not_found", 401);
  return user;
}

function roundCoord(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function toPublicDrop(drop, viewerId = null) {
  const isOwner = viewerId && String(viewerId) === String(drop.ownerId);
  const out = {
    _id: drop._id,
    ownerId: drop.ownerId,
    ownerHandle: drop.ownerHandle || "",
    needText: drop.needText,
    offerText: drop.offerText,
    needCategoryId: drop.needCategoryId,
    offerCategoryId: drop.offerCategoryId,
    timingChip: drop?.timingChip?.value ?? drop.timingChip,
    areaLabel: drop.areaLabel,
    // Other users: ~3 decimal degrees; owner may see stored precision
    lat: isOwner ? (drop.lat ?? null) : roundCoord(drop.lat),
    lng: isOwner ? (drop.lng ?? null) : roundCoord(drop.lng),
    detail: drop.detail || "",
    status: drop.status,
    date: drop.date || null,
    createdAt: drop.createdAt,
    updatedAt: drop.updatedAt,
  };
  if (isOwner) {
    out.yours = true;
  }
  return out;
}

async function getDrop(id, viewerId = null) {
  const drop = await repo.findById(id);
  if (!drop || drop.status === "deleted" || drop.deletedAt) {
    throw AppError("drop_not_found", 404);
  }
  return toPublicDrop(drop, viewerId);
}

async function listPublic({ category, area, timing, cursor, limit, viewerId } = {}) {
  let lim = parseInt(limit, 10);
  if (Number.isNaN(lim) || lim < 1) lim = repo.DEFAULT_LIST_LIMIT;
  if (lim > repo.MAX_LIST_LIMIT) lim = repo.MAX_LIST_LIMIT;

  let items = (await repo.listAll()).filter((d) => d.status === "active" && !d.deletedAt);

  if (category) {
    const c = String(category);
    items = items.filter((d) => String(d.needCategoryId) === c || String(d.offerCategoryId) === c);
  }
  if (area) {
    items = items.filter((d) => String(d.areaLabel).toLowerCase() === String(area).toLowerCase());
  }
  if (timing) {
    items = items.filter((d) => d.timingChip?.value === timing || d.timingChip === timing);
  }

  items.sort((a, b) => {
    const t = String(b.createdAt).localeCompare(String(a.createdAt));
    if (t !== 0) return t;
    return String(b._id).localeCompare(String(a._id));
  });

  const decoded = repo.decodeCursor(cursor);
  if (decoded) {
    items = items.filter((d) => {
      if (d.createdAt < decoded.createdAt) return true;
      if (d.createdAt > decoded.createdAt) return false;
      return String(d._id) < String(decoded.id);
    });
  }

  const page = items.slice(0, lim);
  const last = page[page.length - 1];
  const nextCursor = page.length === lim && last ? repo.encodeCursor(last.createdAt, last._id) : null;

  return {
    data: page.map((d) => toPublicDrop(d, viewerId)),
    meta: { nextCursor, limit: lim },
  };
}

async function listMine(userId, { cursor, limit } = {}) {
  let lim = parseInt(limit, 10);
  if (Number.isNaN(lim) || lim < 1) lim = repo.DEFAULT_LIST_LIMIT;
  if (lim > repo.MAX_LIST_LIMIT) lim = repo.MAX_LIST_LIMIT;

  let items = (await repo.listAll()).filter(
    (d) => String(d.ownerId) === String(userId) && d.status !== "deleted" && !d.deletedAt,
  );

  items.sort((a, b) => {
    const t = String(b.createdAt).localeCompare(String(a.createdAt));
    if (t !== 0) return t;
    return String(b._id).localeCompare(String(a._id));
  });

  const decoded = repo.decodeCursor(cursor);
  if (decoded) {
    items = items.filter((d) => {
      if (d.createdAt < decoded.createdAt) return true;
      if (d.createdAt > decoded.createdAt) return false;
      return String(d._id) < String(decoded.id);
    });
  }

  const page = items.slice(0, lim);
  const last = page[page.length - 1];
  const nextCursor = page.length === lim && last ? repo.encodeCursor(last.createdAt, last._id) : null;

  return {
    data: page.map((d) => toPublicDrop(d, userId)),
    meta: { nextCursor, limit: lim },
  };
}

async function createDrop(userId, body = {}) {
  // Auth + verified/onboarded enforced by route middleware
  const user = await requireUser(userId);

  const {
    needText,
    offerText,
    needCategoryId,
    offerCategoryId,
    timingChip,
    areaLabel,
    detail,
    date,
    lat,
    lng,
    type,
    recipientId,
  } = body;

  if (!needText || !String(needText).trim()) {
    throw AppError("need_text_required", 400);
  }
  if (!offerText || !String(offerText).trim()) {
    throw AppError("offer_text_required", 400);
  }
  if (!needCategoryId || !offerCategoryId) {
    throw AppError("category_required", 400);
  }
  if (!areaLabel || !String(areaLabel).trim()) {
    throw AppError("area_label_required", 400);
  }
  const timingChipDoc = await timingChipRepo.findByValue(timingChip);
  if (!timingChipDoc || !timingChipDoc.active) {
    throw AppError("timing_chip_invalid", 400);
  }
  if (detail && String(detail).length > 500) {
    throw AppError("detail_too_long", 400);
  }
  if (date && isNaN(new Date(date).getTime())) {
    throw AppError("date_invalid", 400);
  }
  const alreadyExist = await repo.find({
    filter: {
      ownerId: user._id,
      needCategoryId: String(needCategoryId),
      offerCategoryId: String(offerCategoryId),
      status: { $in: ["active", "inprogress", "paused"] },
    },
  });
  if (alreadyExist.length > 0) {
    throw AppError("drop_already_exists", 400);
  }
  if (type === "offer" && !recipientId) {
    throw AppError("recipient_id_required_for_offer", 400);
  }

  const drop = await repo.create({
    ownerId: user._id,
    ownerHandle: user.handle || "",
    needText: String(needText).trim(),
    offerText: String(offerText).trim(),
    needCategoryId: String(needCategoryId),
    offerCategoryId: String(offerCategoryId),
    timingChip: timingChipDoc._id,
    areaLabel: String(areaLabel).trim(),
    detail: detail ? String(detail) : "",
    date: date ? new Date(date).toISOString() : null,
    lat: lat ?? null,
    lng: lng ?? null,
    location: lat != null && lng != null ? [Number(lng), Number(lat)] : undefined,
    status: "active",
    type: String(type),
  });

  if (type === "offer") {
    const tapIn = {
      yourOffer: String(offerText).trim(),
      availability: String(timingChipDoc?.label).trim(),
      link: body.link ? String(body.link) : "",
      note: body.note ? String(body.note) : "",
      media: Array.isArray(body.media) ? body.media.map(String) : [],
      ownerId: drop.ownerId,
      recipientId: recipientId ? String(recipientId) : null,
    };
    await tapInService.createTapIn(userId, drop._id, tapIn);
  }

  await createActivity({
    type: activityTypes.NEW_DROP,
    user: drop,
  });
  return toPublicDrop(drop, userId);
}

async function requireOwnerDrop(userId, dropId) {
  const drop = await repo.findById(dropId);
  if (!drop || drop.status === "deleted" || drop.deletedAt) {
    throw AppError("drop_not_found", 404);
  }
  if (String(drop.ownerId) !== String(userId)) {
    throw AppError("access_denied", 403);
  }
  return drop;
}

async function patchDrop(userId, dropId, body = {}) {
  const drop = await requireOwnerDrop(userId, dropId);

  const patch = {};
  const fields = [
    "needText",
    "offerText",
    "needCategoryId",
    "offerCategoryId",
    "timingChip",
    "areaLabel",
    "lat",
    "lng",
    "detail",
  ];
  for (const f of fields) {
    if (body[f] !== undefined) patch[f] = body[f];
  }
  if (body.date !== undefined) {
    patch.date = body.date ? new Date(body.date).toISOString() : null;
  }
  if (body.timingChip !== undefined) {
    const timingChipDoc = await timingChipRepo.findByValue(body.timingChip);
    if (!timingChipDoc || !timingChipDoc.active) {
      throw AppError("timing_chip_invalid", 400);
    }
    patch.timingChip = timingChipDoc._id;
  }
  if (body.needText !== undefined && !String(body.needText).trim()) {
    throw AppError("need_text_required", 400);
  }
  if (body.offerText !== undefined && !String(body.offerText).trim()) {
    throw AppError("offer_text_required", 400);
  }
  if ((body.lat !== undefined || body.lng !== undefined) && (body.lat == null || body.lng == null)) {
    patch.location = undefined;
  } else if (body.lat !== undefined && body.lng !== undefined) {
    patch.lat = Number(body.lat);
    patch.lng = Number(body.lng);
    patch.location = [Number(body.lng), Number(body.lat)];
  }

  const updated = await repo.update(dropId, patch);
  return toPublicDrop(updated, userId);
}

async function updateDropStatus(userId, dropId, newStatus) {
  const drop = await requireOwnerDrop(userId, dropId);

  const validStatuses = ["active", "inprogress", "paused", "completed", "expired", "deleted"];

  if (!validStatuses.includes(newStatus)) {
    throw AppError("invalid_status", 400);
  }

  // paused can only happen from active
  if (newStatus === "paused" && drop.status !== "active") {
    throw AppError("invalid_status_transition", 400);
  }

  // active can only happen from paused
  if (newStatus === "active" && drop.status !== "paused") {
    throw AppError("invalid_status_transition", 400);
  }

  // completed can only happen from inprogress
  if (newStatus === "completed" && drop.status !== "inprogress") {
    throw AppError("invalid_status_transition", 400);
  }

  if (newStatus === "completed") {
    await createActivity({
      type: activityTypes.DROP_COMPLETED,
      user: drop,
    });
  }

  const updated = await repo.update(dropId, {
    status: newStatus,
  });

  return toPublicDrop(updated, userId);
}

async function softDeleteDrop(userId, dropId) {
  await requireOwnerDrop(userId, dropId);
  const updated = await repo.update(dropId, {
    status: "deleted",
    deletedAt: new Date().toISOString(),
  });
  return { deleted: true, _id: updated._id };
}
async function getAllDrops({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);
  const {
    keyword,
    status,
    needCategoryId,
    offerCategoryId,
    areaLabel,
    ownerId,
    timingChip,
    lat,
    lng,
    tag,
    notme,
    type = "need",
  } = req.query;

  const match = {
    ...filter,
  };

  if (notme !== undefined && notme === "true" && req.user?._id) {
    match.ownerId = { $ne: new mongoose.Types.ObjectId(req.user._id) };
  }

  if (needCategoryId) {
    match.needCategoryId = new mongoose.Types.ObjectId(needCategoryId);
  }

  if (offerCategoryId) {
    match.offerCategoryId = new mongoose.Types.ObjectId(offerCategoryId);
  }

  if (type) {
    match.type = type;
  }

  if (areaLabel) {
    match.areaLabel = areaLabel;
  }
  if (ownerId) {
    match.ownerId = new mongoose.Types.ObjectId(ownerId);
  }
  if (timingChip && mongoose.Types.ObjectId.isValid(timingChip)) {
    match.timingChip = new mongoose.Types.ObjectId(timingChip);
  }

  if (keyword?.trim()) {
    const regex = { $regex: keyword.trim(), $options: "i" };

    match.$or = [{ needText: regex }, { offerText: regex }, { detail: regex }, { ownerHandle: regex }];
  }
  if (tag === "today") {
    const timezone = req.user?.timezone || "UTC";
    const startOfToday = moment.tz(timezone).startOf("day").toDate();
    const endOfToday = moment.tz(timezone).endOf("day").toDate();
    match.createdAt = { $gte: startOfToday, $lte: endOfToday };
  }

  const hasGeo = (tag === "near_me" && req.user?.lat != null && req.user?.lng != null) || (lat != null && lng != null);
  const viewerLat = req.user?.lat ?? Number(lat);
  const viewerLng = req.user?.lng ?? Number(lng);
  const parsedRadius = DEFAULT_RADAR_RADIUS_KM;
  const pipeline = [];
  if (hasGeo) {
    pipeline.push({
      $geoNear: {
        near: { type: "Point", coordinates: [viewerLng, viewerLat] },
        key: "location",
        distanceField: "distanceMeters",
        maxDistance: parsedRadius * 1000,
        spherical: true,
        query: match,
      },
    });
  } else {
    pipeline.push({ $match: match });
  }
  const [result] = await Drop.aggregate([
    ...pipeline,

    {
      $facet: {
        drops: [
          ...(status ? [{ $match: { status } }] : []),
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },

          {
            $lookup: {
              from: "categories",
              localField: "needCategoryId",
              foreignField: "_id",
              pipeline: [{ $project: { name: 1, image: 1 } }],
              as: "needCategory",
            },
          },
          {
            $lookup: {
              from: "categories",
              localField: "offerCategoryId",
              foreignField: "_id",
              pipeline: [{ $project: { name: 1, image: 1 } }],
              as: "offerCategory",
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "ownerId",
              foreignField: "_id",
              pipeline: [
                {
                  $project: {
                    name: 1,
                    email: 1,
                    profileIcon: { $concat: [process.env.S3_BASE_URL || "", "$profileIcon"] },
                  },
                },
              ],
              as: "owner",
            },
          },

          {
            $lookup: {
              from: "timingchips",
              localField: "timingChip",
              foreignField: "_id",
              as: "timingChipDetails",
            },
          },

          {
            $set: {
              needCategory: { $first: "$needCategory" },
              offerCategory: { $first: "$offerCategory" },
              owner: { $first: "$owner" },
              timingChip: { $first: "$timingChipDetails" },
            },
          },

          {
            $project: {
              _id: 1,
              ownerId: 1,
              ownerHandle: 1,
              owner: 1,
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
              detail: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              distanceMeters: 1,
            },
          },
        ],

        total: [{ $count: "count" }],

        counts: [
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;

  const dropsCount = (result?.counts || []).reduce(
    (acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    },
    {
      active: 0,
      inprogress: 0,
      paused: 0,
      completed: 0,
      expired: 0,
    },
  );
  const categories = await Category.find({ active: true }, { _id: 1, name: 1 }).lean();
  const meta = generateMeta(page, limit, total);
  meta.counts = dropsCount;
  meta.timingChips = [{ value: null, label: "All" }, ...(await timingChipRepo.find({}))];
  meta.areas = [{ value: null, label: "All" }, ...(await getDropAreaLabels())];
  meta.categories = [{ _id: null, name: "All" }, ...categories];

  return {
    data: result?.drops || [],
    meta,
  };
}
const getDropAreaLabels = async () => {
  const result = await Drop.distinct("areaLabel", {
    areaLabel: { $nin: [null, ""] },
  });
  return result?.map((v) => ({ label: v, value: v }));
};

module.exports = {
  listPublic,
  getAllDrops,
  listMine,
  getDrop,
  createDrop,
  patchDrop,
  updateDropStatus,
  softDeleteDrop,
  AppError,
  getDropAreaLabels,
};
