/**
 * Mongo User repository — same shape as memoryUserStore for TradeDrop services.
 * Maps passwordHash ↔ User.password, otp ↔ User.tfOtp.
 */
const { User } = require("../../../models/UserModel");
const { idStr, idStrOrNull, mapIds } = require("../_shared/serialize");

function toPublic(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return {
    _id: idStr(o._id),
    email: o.email,
    passwordHash: o.password || "",
    name: o.name || "",
    handle: o.handle || "",
    timezone: o.timezone || "UTC",
    language: o.language || "en",
    profileIcon: o.profileIcon || "",
    coverImage: o.coverImage || "",
    bio: o.bio || "",
    areaLabel: o.areaLabel || "",
    lat: o.lat ?? null,
    lng: o.lng ?? null,
    openToTrade: o.openToTrade !== false,
    radarVisible: o.radarVisible !== false,
    hideFromSearch: !!o.hideFromSearch,
    verified: !!o.verified,
    onboarding: !!o.onboarding,
    deletedAt: o.deletedAt || null,
    verificationStatus: {
      email: o.verificationStatus?.email || "pending",
      phoneNumber: o.verificationStatus?.phoneNumber || "pending",
    },
    accountState: {
      userType: o.accountState?.userType || "user",
      status: o.accountState?.status || "active",
      reason: o.accountState?.reason || "",
    },
    otp: o.tfOtp || {},
    crafts: mapIds(o.crafts || []),
    links: o.links || [],
    portfolioItems: (o.portfolioItems || []).map((p) => ({
      _id: idStr(p._id),
      imageUrl: p.imageUrl || "",
      title: p.title || "",
      tags: p.tags || [],
      sortOrder: p.sortOrder ?? 0,
    })),
    phoneNumber: o.phoneNumber || { code: "", number: "" },
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function patchToMongo(patch = {}) {
  const out = { ...patch };
  if (patch.passwordHash !== undefined) {
    out.password = patch.passwordHash;
    delete out.passwordHash;
  }
  if (patch.otp !== undefined) {
    out.tfOtp = patch.otp;
    delete out.otp;
  }
  delete out._id;
  return out;
}

async function findById(id) {
  if (!id) return null;
  const doc = await User.findById(id).lean();
  return toPublic(doc);
}

async function findByEmail(email) {
  if (!email) return null;
  const doc = await User.findOne({
    email: String(email).toLowerCase().trim(),
  }).lean();
  return toPublic(doc);
}

async function findByHandle(handle) {
  if (!handle) return null;
  const doc = await User.findOne({
    handle: String(handle).toLowerCase().trim(),
  }).lean();
  return toPublic(doc);
}

async function create(data) {
  const payload = patchToMongo({
    email: data.email,
    passwordHash: data.passwordHash,
    name: data.name || "",
    handle: data.handle ? String(data.handle).toLowerCase().trim() : undefined,
    timezone: data.timezone || "UTC",
    language: data.language || "en",
    profileIcon: data.profileIcon || "",
    bio: data.bio || "",
    areaLabel: data.areaLabel || "",
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    openToTrade: data.openToTrade ?? true,
    radarVisible: data.radarVisible ?? true,
    hideFromSearch: data.hideFromSearch ?? false,
    verified: data.verified ?? false,
    onboardingComplete: data.onboarding ?? false,
    verificationStatus: data.verificationStatus || {
      email: "pending",
      phoneNumber: "pending",
    },
    accountState: data.accountState || {
      userType: "user",
      status: "active",
      reason: "",
    },
    otp: data.otp || {},
    crafts: data.crafts || [],
    links: data.links || [],
    prompts: data.prompts || [],
    needText: data.needText || "",
    needCategoryId: data.needCategoryId || null,
    offerText: data.offerText || "",
    offerCategoryId: data.offerCategoryId || null,
    timingChip: data.timingChip || null,
    availableDates: data.availableDates || [],
    portfolioItems: data.portfolioItems || [],
    verificationRequests: data.verificationRequests || [],
    phoneNumber: data.phoneNumber || { code: "", number: "" },
    provider: "email",
  });

  // Drop empty handle so sparse unique index works
  if (!payload.handle) delete payload.handle;

  // insertOne bypasses duplicate save-hash concerns; password already hashed by service
  const doc = new User(payload);
  await doc.save();
  return findById(doc._id);
}

async function update(id, patch) {
  const existing = await User.findById(id).lean();
  if (!existing) return null;

  const mongoPatch = patchToMongo(patch);
  if (patch.verificationStatus) {
    mongoPatch.verificationStatus = {
      ...(existing.verificationStatus || {}),
      ...patch.verificationStatus,
    };
  }
  if (patch.accountState) {
    mongoPatch.accountState = {
      ...(existing.accountState || {}),
      ...patch.accountState,
    };
  }
  if (patch.otp) {
    mongoPatch.tfOtp = { ...(existing.tfOtp || {}), ...patch.otp };
    delete mongoPatch.otp;
  }

  const doc = await User.findByIdAndUpdate(id, { $set: mongoPatch }, { new: true, runValidators: true }).lean();
  return toPublic(doc);
}

async function listAll() {
  const docs = await User.find({}).lean();
  return docs.map(toPublic);
}

async function reset() {
  // Integration tests call clearCollections; no-op here for interface parity
}

module.exports = {
  reset,
  findById,
  findByEmail,
  findByHandle,
  create,
  update,
  listAll,
};
