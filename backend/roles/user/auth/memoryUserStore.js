/**
 * In-memory user store for TradeDrop Auth mock (Slice 1).
 * No Mongo. Reset between tests via resetMemoryStore().
 */

const { randomBytes } = require("crypto");

/** @type {Map<string, object>} */
const usersById = new Map();
/** @type {Map<string, string>} email(lower) -> userId */
const emailIndex = new Map();
/** @type {Map<string, string>} handle(lower) -> userId */
const handleIndex = new Map();

function createId() {
  return randomBytes(12).toString("hex");
}

function resetMemoryStore() {
  usersById.clear();
  emailIndex.clear();
  handleIndex.clear();
}

function cloneUser(user) {
  return JSON.parse(JSON.stringify(user));
}

function findById(id) {
  const u = usersById.get(String(id));
  return u ? cloneUser(u) : null;
}

function findByEmail(email) {
  if (!email) return null;
  const id = emailIndex.get(String(email).toLowerCase().trim());
  return id ? findById(id) : null;
}

function findByHandle(handle) {
  if (!handle) return null;
  const id = handleIndex.get(String(handle).toLowerCase().trim());
  return id ? findById(id) : null;
}

function saveUser(user) {
  const id = String(user._id);
  const prev = usersById.get(id);
  if (prev) {
    const prevEmail = String(prev.email || "").toLowerCase();
    const prevHandle = String(prev.handle || "").toLowerCase();
    if (prevEmail && emailIndex.get(prevEmail) === id) emailIndex.delete(prevEmail);
    if (prevHandle && handleIndex.get(prevHandle) === id) handleIndex.delete(prevHandle);
  }

  usersById.set(id, cloneUser(user));
  const emailKey = String(user.email || "")
    .toLowerCase()
    .trim();
  if (emailKey) {
    emailIndex.set(emailKey, id);
  }
  if (user.handle && !user.deletedAt) {
    handleIndex.set(String(user.handle).toLowerCase().trim(), id);
  } else if (user.handle && user.deletedAt) {
    // Keep handle indexed for uniqueness, but public profile returns 404 via deletedAt
    handleIndex.set(String(user.handle).toLowerCase().trim(), id);
  }
  return findById(id);
}

function createUser(partial) {
  const _id = partial._id || createId();
  const now = new Date().toISOString();
  const user = {
    _id,
    email: String(partial.email).toLowerCase().trim(),
    passwordHash: partial.passwordHash,
    name: partial.name || "",
    handle: partial.handle || "",
    timezone: partial.timezone || "UTC",
    language: partial.language || "en",
    avatarUrl: partial.avatarUrl || "",
    bio: partial.bio || "",
    areaLabel: partial.areaLabel || "",
    lat: partial.lat ?? null,
    lng: partial.lng ?? null,
    openToTrade: partial.openToTrade ?? true,
    radarVisible: partial.radarVisible ?? true,
    hideFromSearch: partial.hideFromSearch ?? false,
    verified: partial.verified ?? false,
    onboardingComplete: partialonboarding ?? false,
    deletedAt: null,
    verificationStatus: {
      email: partial.verificationStatus?.email || "pending",
      phoneNumber: partial.verificationStatus?.phoneNumber || "pending",
    },
    accountState: {
      userType: partial.accountState?.userType || "user",
      status: partial.accountState?.status || "active",
      reason: "",
    },
    otp: {
      signup: null,
      password_reset: null,
    },
    crafts: partial.crafts || [],
    links: partial.links || [],
    prompts: partial.prompts || [],
    needText: partial.needText || "",
    needCategoryId: partial.needCategoryId || null,
    offerText: partial.offerText || "",
    offerCategoryId: partial.offerCategoryId || null,
    timingChip: partial.timingChip || null,
    availableDates: partial.availableDates || [],
    portfolioItems: partial.portfolioItems || [],
    verificationRequests: partial.verificationRequests || [],
    phoneNumber: partial.phoneNumber || { code: "", number: "" },
    createdAt: now,
    updatedAt: now,
    ...partial,
    _id,
  };
  return saveUser(user);
}

function updateUser(id, patch) {
  const existing = usersById.get(String(id));
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    _id: existing._id,
    updatedAt: new Date().toISOString(),
  };
  if (patch.verificationStatus) {
    next.verificationStatus = {
      ...existing.verificationStatus,
      ...patch.verificationStatus,
    };
  }
  if (patch.accountState) {
    next.accountState = { ...existing.accountState, ...patch.accountState };
  }
  if (patch.otp) {
    next.otp = { ...existing.otp, ...patch.otp };
  }
  return saveUser(next);
}

function listAllUsers() {
  return Array.from(usersById.values()).map(cloneUser);
}

module.exports = {
  resetMemoryStore,
  createId,
  findById,
  findByEmail,
  findByHandle,
  createUser,
  updateUser,
  saveUser,
  listAllUsers,
};
