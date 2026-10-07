/**
 * In-memory drops store (Slice 4 mock). No Mongo.
 */

const { randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const authRepo = require("../auth/authRepository");
const catalogRepo = require("../catalog/catalogRepository");
const timingChipRepo = require("../catalog/timingChipRepository");

const DROP_TTL_DAYS = 14;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** @type {Map<string, object>} */
let dropsById = new Map();

function createId() {
  return randomBytes(12).toString("hex");
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function encodeCursor(createdAt, id) {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
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

async function ensureSeedUser({ email, password, handle, name, areaLabel, lat, lng, craftIds }) {
  const cats = catalogRepo.listCategories();
  const craftId = (craftIds && craftIds[0]) || cats[0]?._id || "seed-craft";
  const crafts = craftIds && craftIds.length ? craftIds : [craftId];

  let user = authRepo.findByHandle(handle);
  if (!user || user.deletedAt) {
    user = authRepo.findByEmail(email);
  }
  if (user && !user.deletedAt) {
    // Keep radar seed coords / crafts current for slice 8
    return authRepo.update(user._id, {
      areaLabel: areaLabel || user.areaLabel || "Soho",
      lat: lat ?? user.lat ?? null,
      lng: lng ?? user.lng ?? null,
      crafts,
      needCategoryId: craftId,
      offerCategoryId: craftId,
      radarVisible: true,
      openToTrade: true,
      onboardingComplete: true,
      hideFromSearch: false,
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  return authRepo.create({
    email,
    passwordHash,
    name,
    handle,
    verificationStatus: { email: "verified", phoneNumber: "pending" },
    onboardingComplete: true,
    crafts,
    needText: "Seed need",
    needCategoryId: craftId,
    offerText: "Seed offer",
    offerCategoryId: craftId,
    areaLabel: areaLabel || "Soho",
    lat: lat ?? null,
    lng: lng ?? null,
    timingChip: "flexible",
    openToTrade: true,
    radarVisible: true,
    hideFromSearch: false,
  });
}

function createDropDoc(partial) {
  const now = new Date().toISOString();
  const _id = partial._id || createId();
  const timingChip =
    typeof partial.timingChip === "string" ? timingChipRepo.findById(partial.timingChip) : partial.timingChip;
  return {
    _id,
    ownerId: partial.ownerId,
    ownerHandle: partial.ownerHandle || "",
    needText: partial.needText,
    offerText: partial.offerText,
    needCategoryId: partial.needCategoryId,
    offerCategoryId: partial.offerCategoryId,
    timingChip,
    areaLabel: partial.areaLabel,
    lat: partial.lat ?? null,
    lng: partial.lng ?? null,
    detail: partial.detail || "",
    date: partial.date || null,
    status: partial.status || "active",
    deletedAt: partial.deletedAt || null,
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
  };
}

async function seedDemoDrops() {
  catalogRepo.reset();
  timingChipRepo.reset();
  const timingChips = Object.fromEntries(timingChipRepo.listAll().map((chip) => [chip.value, chip]));
  const cats = catalogRepo.listCategories();
  const bySlug = Object.fromEntries(cats.map((c) => [c.slug, c._id]));

  const maya = await ensureSeedUser({
    email: "maya@tradedrop.local",
    password: "password123",
    handle: "maya_lens",
    name: "Maya",
    areaLabel: "Soho",
    // raw stored precision — radar must round to ~3 decimals
    lat: 40.7234567,
    lng: -74.0023456,
    craftIds: [bySlug.photographer || cats[0]._id, bySlug.model || cats[0]._id],
  });
  const jordan = await ensureSeedUser({
    email: "jordan@tradedrop.local",
    password: "password123",
    handle: "cutbyjordan",
    name: "Jordan",
    areaLabel: "Brooklyn",
    lat: 40.6781234,
    lng: -73.9445678,
    craftIds: [bySlug.hairdresser || cats[0]._id, bySlug.barber || cats[0]._id],
  });

  const seedRows = [
    {
      ownerId: maya._id,
      ownerHandle: "maya_lens",
      needText: "Model for golden hour",
      offerText: "Digitals + edited selects",
      needCategoryId: bySlug.model || cats[0]._id,
      offerCategoryId: bySlug.photographer || cats[0]._id,
      areaLabel: "Soho",
      timingChip: "this_week",
      lat: 40.7234567,
      lng: -74.0023456,
    },
    {
      ownerId: jordan._id,
      ownerHandle: "cutbyjordan",
      needText: "Photographer this weekend",
      offerText: "Cut + color + styling",
      needCategoryId: bySlug.photographer || cats[0]._id,
      offerCategoryId: bySlug.barber || cats[0]._id,
      areaLabel: "Brooklyn",
      timingChip: "asap",
      lat: 40.6781234,
      lng: -73.9445678,
    },
    {
      ownerId: maya._id,
      ownerHandle: "maya_lens",
      needText: "Portfolio refresh",
      offerText: "Two makeup looks, lashes",
      needCategoryId: bySlug.photographer || cats[0]._id,
      offerCategoryId: bySlug.makeup || cats[0]._id,
      areaLabel: "Shoreditch",
      timingChip: "this_month",
      lat: 40.7234567,
      lng: -74.0023456,
    },
    {
      ownerId: jordan._id,
      ownerHandle: "cutbyjordan",
      needText: "BTS video of a salon day",
      offerText: "Hair trial for a shoot",
      needCategoryId: bySlug.videographer || cats[0]._id,
      offerCategoryId: bySlug.hairdresser || cats[0]._id,
      areaLabel: "LES",
      timingChip: "flexible",
      lat: 40.6781234,
      lng: -73.9445678,
    },
  ];

  // Stagger createdAt so cursor pagination is deterministic
  const base = Date.now();
  seedRows.forEach((row, i) => {
    const createdAt = new Date(base - i * 1000).toISOString();
    const doc = createDropDoc({
      ...row,
      timingChip: timingChips[row.timingChip],
      createdAt,
      status: "active",
    });
    dropsById.set(doc._id, doc);
  });
}

async function resetDropStore(options = { seed: true }) {
  dropsById = new Map();
  if (options.seed !== false) {
    await seedDemoDrops();
  }
}

function save(drop) {
  dropsById.set(String(drop._id), clone(drop));
  return clone(drop);
}

function findById(id) {
  const d = dropsById.get(String(id));
  return d ? clone(d) : null;
}

function create(partial) {
  const doc = createDropDoc(partial);
  return save(doc);
}

function update(id, patch) {
  const existing = dropsById.get(String(id));
  if (!existing) return null;
  const normalizedPatch = { ...patch };
  if (typeof normalizedPatch.timingChip === "string") {
    normalizedPatch.timingChip = timingChipRepo.findById(normalizedPatch.timingChip);
  }
  const next = {
    ...existing,
    ...normalizedPatch,
    _id: existing._id,
    updatedAt: new Date().toISOString(),
  };
  return save(next);
}

function listAll() {
  return Array.from(dropsById.values()).map(clone);
}

function whenReady() {
  return Promise.resolve();
}

module.exports = {
  DROP_TTL_DAYS,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  resetDropStore,
  whenReady,
  findById,
  create,
  update,
  listAll,
  encodeCursor,
  decodeCursor,
  addDays,
  createId,
};
