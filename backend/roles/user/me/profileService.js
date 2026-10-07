const { randomBytes } = require("crypto");
const repo = require("../auth/authRepository");
const catalogRepo = require("../catalog/catalogRepository");
const Drop = require("@backend/models/Drop");
const badgesService = require("../../admin/badges/badgesService");
const { checkAndAwardBadges } = require("../../admin/badges/badgeEngine");

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const TIMING_CHIPS = ["asap", "this_week", "this_month", "flexible"];
const MAX_PORTFOLIO = 12;
const MAX_BIO = 280;
const MAX_PROMPTS = 3;
const MAX_PROMPT_LEN = 40;
const MAX_NEED = 80;

function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

function createId() {
  return randomBytes(12).toString("hex");
}

function roundCoord(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 1000) / 1000;
}

async function requireUser(userId) {
  const user = await repo.findById(userId);
  if (!user || user.deletedAt) throw AppError("account_not_found", 401);
  return user;
}

function selfProfile(user) {
  return {
    basicInfo: {
      _id: user._id,
      name: user.name || "",
      email: user.email,
      handle: user.handle || "",
      avatarUrl: user.avatarUrl || "",
      bio: user.bio || "",
      language: user.language || "en",
      links: user.links || [],
    },
    accountState: {
      userType: user.accountState?.userType || "user",
      status: user.accountState?.status || "active",
      verificationStatus: {
        email: user.verificationStatus?.email || "pending",
        phoneNumber: user.verificationStatus?.phoneNumber || "pending",
      },
    },
    onboarding: user.onboarding,
    privacy: {
      radarVisible: user.radarVisible !== false,
      hideFromSearch: !!user.hideFromSearch,
      openToTrade: user.openToTrade !== false,
    },
    location: {
      areaLabel: user.areaLabel || "",
      lat: user.lat,
      lng: user.lng,
    },
    portfolioItems: user.portfolioItems || [],
    verified: !!user.verified,
    crafts: user.crafts || [],
    metadata: {
      timezone: user.timezone || "UTC",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

async function publicProfile(user) {
  let rating = null;
  let collaborators = [];
  try {
    const tradeService = require("../trades/tradeService");
    rating = await tradeService.ratingForUser(user._id);
    collaborators = await tradeService.collaboratorsForUser(user._id);
  } catch (_) {
    // trades module optional during early slices
  }

  const out = {
    basicInfo: {
      _id: user._id,
      name: user.name || "",
      handle: user.handle || "",
      avatarUrl: user.avatarUrl || "",
      bio: user.bio || "",
      links: user.links || [],
      prompts: user.prompts || [],
    },
    crafts: user.crafts || [],
    areaLabel: user.areaLabel || "",
    location: {
      areaLabel: user.areaLabel || "",
      lat: roundCoord(user.lat),
      lng: roundCoord(user.lng),
    },
    openToTrade: user.openToTrade !== false,
    verified: !!user.verified,
    portfolioItems: (user.portfolioItems || []).map((p) => ({
      _id: p._id,
      imageUrl: p.imageUrl,
      title: p.title || "",
      tags: p.tags || [],
      sortOrder: p.sortOrder ?? 0,
    })),
    onboarding: !!user.onboarding,
    collaborators,
  };
  if (rating) out.rating = rating;

  try {
    out.badges = await badgesService.listUserBadges(user._id);
  } catch (_) {
    out.badges = [];
  }

  return out;
}

async function getMe(userId) {
  const user = await requireUser(userId);
  const profile = selfProfile(user);

  checkAndAwardBadges(userId, "founding_member").catch((err) => console.error("[checkAndAwardBadges] failed:", err));

  try {
    profile.badges = await badgesService.listUserBadges(userId);
  } catch (_) {
    profile.badges = [];
  }

  return profile;
}

async function addCraft(userId, craftId) {
  const user = await requireUser(userId);
  const craftRef = String(craftId || "").trim();
  if (!craftRef) throw AppError("craft_required", 400);

  const categories = await catalogRepo.listCategories();
  const category = categories.find((item) => String(item._id) === craftRef || item.slug === craftRef);
  if (!category) throw AppError("craft_not_found", 404);

  const normalizedCraftId = String(category._id);
  const crafts = (user.crafts || []).map(String);
  if (crafts.includes(normalizedCraftId)) {
    throw AppError("craft_already_exists", 409);
  }

  const updated = await repo.update(user._id, {
    crafts: [...crafts, normalizedCraftId],
  });
  return selfProfile(updated);
}

async function patchMe(userId, body = {}) {
  const user = await requireUser(userId);
  const patch = {};

  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.bio !== undefined) {
    const bio = String(body.bio);
    if (bio.length > MAX_BIO) throw AppError("bio_too_long", 400);
    patch.bio = bio;
  }
  if (body.timezone !== undefined) patch.timezone = String(body.timezone);
  if (body.language !== undefined) patch.language = String(body.language);
  if (body.areaLabel !== undefined) patch.areaLabel = String(body.areaLabel);
  if (body.lat !== undefined) patch.lat = body.lat === null ? null : Number(body.lat);
  if (body.lng !== undefined) patch.lng = body.lng === null ? null : Number(body.lng);
  if (body.lat != undefined && body.lng != undefined) {
    if (body.lat != null && body.lng != null) {
      patch.location = [Number(body.lng), Number(body.lat)];
    } else {
      patch.location = undefined;
    }
  }
  if (body.links !== undefined) {
    if (!Array.isArray(body.links)) throw AppError("links_invalid", 400);
    patch.links = body.links.map((l) => ({
      kind: l.kind === "instagram" ? "instagram" : "website",
      url: String(l.url || ""),
    }));
  }

  if (body.prompts !== undefined) {
    if (!Array.isArray(body.prompts)) throw AppError("prompts_invalid", 400);
    if (body.prompts.length > MAX_PROMPTS) throw AppError("prompts_max", 400);
    patch.prompts = body.prompts.map((p) => {
      const s = String(p);
      if (s.length > MAX_PROMPT_LEN) throw AppError("prompt_too_long", 400);
      return s;
    });
  }

  if (body.handle !== undefined) {
    const handle = String(body.handle).toLowerCase().trim();
    if (!HANDLE_RE.test(handle)) throw AppError("handle_invalid", 400);
    const existing = await repo.findByHandle(handle);
    if (existing && String(existing._id) !== String(user._id)) {
      throw AppError("handle_already_exists", 409);
    }
    patch.handle = handle;
  }

  const updated = await repo.update(user._id, patch);
  return selfProfile(updated);
}

async function setAvatar(userId, imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") {
    throw AppError("avatar_url_required", 400);
  }
  const user = await requireUser(userId);
  const updated = await repo.update(user._id, { avatarUrl: imageUrl.trim() });
  return selfProfile(updated);
}

async function completeOnboarding(userId, body = {}) {
  const user = await requireUser(userId);

  if (user.verificationStatus?.email !== "verified") throw AppError("email_unverified", 403);

  if (user.onboarding) throw AppError("onboarding_already_completed", 400);

  // Resolve crafts
  const categories = await catalogRepo.listCategories();
  const categoryMap = new Map();

  categories.forEach((c) => {
    categoryMap.set(String(c._id), String(c._id));
    categoryMap.set(c.slug, String(c._id));
  });

  const resolveCategoryRef = (ref) => categoryMap.get(String(ref)) || String(ref);

  let craftIds = user.crafts || [];

  // Add/update crafts first
  if (Array.isArray(body.crafts)) {
    craftIds = body.crafts.map(resolveCategoryRef);

    if (!craftIds.length) throw AppError("crafts_required", 400);

    await repo.update(user._id, { crafts: craftIds });
    return selfProfile(await repo.update(user._id, { crafts: craftIds }));
  }

  // Crafts required
  if (!craftIds.length) throw AppError("crafts_required", 400);

  // Skip after crafts are saved
  if (body.skipped === true) {
    const updated = await repo.update(user._id, {
      onboarding: true,
      crafts: craftIds,
    });

    return selfProfile(updated);
  }

  // Drop data
  const {
    needText,
    offerText,
    needCategoryId,
    offerCategoryId,
    areaLabel,
    timingChip,
    availableDates,
    detail,
    usageRights,
    media,
    lat,
    lng,
    date,
  } = body;

  if (!needText || !offerText || !needCategoryId || !offerCategoryId) throw AppError("onboarding_fields_required", 400);

  if (lat === null || lat === undefined || lat === "") throw AppError("lat_required", 400);
  if (lng === null || lng === undefined || lng === "") throw AppError("lng_required", 400);

  if (String(needText).length > MAX_NEED) throw AppError("need_text_too_long", 400);

  if (!areaLabel) throw AppError("area_label_required", 400);

  if (!date) throw AppError("date_required", 400);

  const needId = resolveCategoryRef(needCategoryId);
  const offerId = resolveCategoryRef(offerCategoryId);

  const cleanArea = String(areaLabel).trim();
  const normalizedLat = lat === null || lat === undefined || lat === "" ? null : Number(lat);
  const normalizedLng = lng === null || lng === undefined || lng === "" ? null : Number(lng);

  const drop = await Drop.create({
    ownerId: user._id,
    ownerHandle: user.handle || "",
    needText: String(needText).trim(),
    offerText: String(offerText).trim(),
    needCategoryId: needId,
    offerCategoryId: offerId,
    timingChip,
    availableDates: Array.isArray(availableDates) ? availableDates : [],
    areaLabel: cleanArea,
    lat: normalizedLat,
    lng: normalizedLng,
    detail: detail ? String(detail).trim() : "",
    usageRights: usageRights ? String(usageRights).trim() : "",
    media: Array.isArray(media) ? media.map(String) : [],
    status: "active",
    date: date ? new Date(date) : new Date(),
  });

  const updated = await repo.update(user._id, {
    crafts: craftIds,
    onboarding: true,
  });

  return {
    profile: selfProfile(updated),
    drop,
  };
}

async function addPortfolioItem(userId, body = {}) {
  const user = await requireUser(userId);

  const items = [...(user.portfolioItems || [])];

  // ==========================================
  // MAX PORTFOLIO CHECK
  // ==========================================
  if (items.length >= MAX_PORTFOLIO) {
    throw AppError("portfolio_max_reached", 400);
  }

  if (items.some((i) => i.title?.toLowerCase() === body.title?.toLowerCase())) {
    throw AppError("portfolio_item_duplicate", 400);
  }

  // ==========================================
  // IMAGE REQUIRED
  // ==========================================
  if (!body.imageUrl || typeof body.imageUrl !== "string") {
    throw AppError("image_url_required", 400);
  }

  // ==========================================
  // BUILD PORTFOLIO ITEM
  // ==========================================
  const item = {
    _id: createId(),

    imageUrl: String(body.imageUrl).trim(),

    title: body.title ? String(body.title).trim() : "",

    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],

    sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : items.length,

    crafts: Array.isArray(body.crafts) ? body.crafts.map(String) : [],
    link: body.link ? String(body.link).trim() : "",
  };

  // ==========================================
  // SAVE
  // ==========================================
  items.push(item);

  const updated = await repo.update(user._id, {
    portfolioItems: items,
  });

  return {
    item,
    profile: selfProfile(updated),
  };
}

async function deletePortfolioItem(userId, itemId) {
  const user = await requireUser(userId);
  const items = [...(user.portfolioItems || [])];
  const idx = items.findIndex((i) => String(i._id) === String(itemId));
  if (idx === -1) throw AppError("portfolio_item_not_found", 404);
  items.splice(idx, 1);
  const updated = await repo.update(user._id, { portfolioItems: items });
  return selfProfile(updated);
}

async function patchPrivacy(userId, body = {}) {
  const user = await requireUser(userId);
  const patch = {};
  if (body.radarVisible !== undefined) patch.radarVisible = !!body.radarVisible;
  if (body.hideFromSearch !== undefined) {
    patch.hideFromSearch = !!body.hideFromSearch;
  }
  if (body.openToTrade !== undefined) patch.openToTrade = !!body.openToTrade;
  const updated = await repo.update(user._id, patch);
  return selfProfile(updated);
}

async function requestVerification(userId, note = "") {
  const user = await requireUser(userId);
  const requests = [...(user.verificationRequests || [])];
  const reqDoc = {
    _id: createId(),
    note: String(note || ""),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  requests.push(reqDoc);
  const updated = await repo.update(user._id, { verificationRequests: requests });
  return { request: reqDoc, profile: selfProfile(updated) };
}

async function softDeleteMe(userId) {
  const user = await requireUser(userId);
  // Purge PII / secrets; keep handle for historical reviews
  await repo.update(user._id, {
    email: "",
    passwordHash: "",
    phoneNumber: { code: "", number: "" },
    otp: { signup: null, password_reset: null },
    deletedAt: new Date().toISOString(),
    accountState: {
      ...(user.accountState || {}),
      status: "deleted",
    },
  });
  return { deleted: true };
}

async function getPublicByHandle(handle) {
  const h = String(handle || "")
    .toLowerCase()
    .trim();
  if (!h) throw AppError("handle_required", 400);
  const user = await repo.findByHandle(h);
  if (!user || user.deletedAt) throw AppError("user_not_found", 404);
  return await publicProfile(user);
}

module.exports = {
  getMe,
  addCraft,
  patchMe,
  setAvatar,
  completeOnboarding,
  addPortfolioItem,
  deletePortfolioItem,
  patchPrivacy,
  requestVerification,
  softDeleteMe,
  getPublicByHandle,
  AppError,
  roundCoord,
  MAX_PORTFOLIO,
};
