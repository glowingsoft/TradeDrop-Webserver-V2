const { Drop } = require("../../../models/Drop");
const { idStr, idStrOrNull } = require("../_shared/serialize");

const DROP_TTL_DAYS = 14;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function encodeCursor(createdAt, id) {
  const created = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  return Buffer.from(`${created}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
    const [createdAt, id] = raw.split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function toPublic(doc) {
  if (!doc) return null;
  return {
    _id: idStr(doc._id),
    ownerId: idStr(doc.ownerId),
    ownerHandle: doc.ownerHandle || "",
    needText: doc.needText,
    offerText: doc.offerText,
    type: doc.type,
    needCategoryId: idStr(doc.needCategoryId),
    offerCategoryId: idStr(doc.offerCategoryId),
    timingChip:
      doc.timingChip && typeof doc.timingChip === "object"
        ? {
            _id: idStr(doc.timingChip._id),
            value: doc.timingChip.value,
            label: doc.timingChip.label,
            active: !!doc.timingChip.active,
          }
        : doc.timingChip,
    areaLabel: doc.areaLabel,
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    detail: doc.detail || "",
    date: doc.date || null,
    status: doc.status,
    deletedAt: doc.deletedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function findById(id) {
  if (!id) return null;
  const doc = await Drop.findById(id).populate("timingChip").lean();
  return toPublic(doc);
}

async function find({ filter = {} }) {
  const docs = await Drop.find(filter).lean();
  return docs;
}

async function create(data) {
  const doc = await Drop.create({
    ownerId: data.ownerId,
    ownerHandle: data.ownerHandle || "",
    needText: data.needText,
    offerText: data.offerText,
    needCategoryId: data.needCategoryId,
    offerCategoryId: data.offerCategoryId,
    timingChip: data.timingChip,
    areaLabel: data.areaLabel,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    detail: data.detail || "",
    date: data.date || null,
    status: data.status || "active",
    type: data.type || "need",
    deletedAt: data.deletedAt || null,
  });
  await doc.populate("timingChip");
  return toPublic(doc.toObject());
}

async function update(id, patch) {
  const doc = await Drop.findByIdAndUpdate(id, { $set: patch }, { new: true }).populate("timingChip").lean();
  return toPublic(doc);
}

async function remove(id) {
  const doc = await Drop.findByIdAndDelete(id).lean();
  return toPublic(doc);
}

async function listAll() {
  const docs = await Drop.find({}).populate("timingChip").lean();
  return docs.map(toPublic);
}

async function reset() {}

async function whenReady() {
  return Promise.resolve();
}

module.exports = {
  reset,
  whenReady,
  findById,
  find,
  create,
  update,
  listAll,
  encodeCursor,
  decodeCursor,
  DROP_TTL_DAYS,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  remove,
};
