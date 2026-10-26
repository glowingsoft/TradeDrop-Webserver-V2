const { randomBytes } = require("crypto");
const repo = require("../auth/authRepository");
const catalogRepo = require("../catalog/mongoCatalogRepository");
const badgesService = require("../../admin/badges/badgesService");
const { checkAndAwardBadges } = require("../../admin/badges/badgeEngine");
const { UserBadge } = require("../../../models/UserBadge");
const { getFullImageUrl } = require("@helperUtils/imageHelper");

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const TIMING_CHIPS = ["asap", "this_week", "this_month", "flexible"];
const MAX_PORTFOLIO = 12;
const MAX_BIO = 280;
const MAX_PROMPTS = 3;
const MAX_PROMPT_LEN = 40;

function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

function createId() {
  return randomBytes(12).toString("hex");
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
      profileIcon: user.profileIcon ? getFullImageUrl(user.profileIcon) || "" : "",
      coverImage: user.coverImage ? getFullImageUrl(user.coverImage) || "" : "",
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

async function addCraft(userId, craftids) {
  const user = await requireUser(userId);
  const craftRefs = (Array.isArray(craftids) ? craftids : [craftids])
    .map((ref) => String(ref || "").trim())
    .filter(Boolean);
  if (!craftRefs.length) throw AppError("craft_required", 400);

  const categories = await catalogRepo.listCategories();
  const crafts = (user.crafts || []).map(String);
  const newCraftIds = [];

  for (const craftRef of craftRefs) {
    const category = categories.find((item) => String(item._id) === craftRef || item.slug === craftRef);
    if (!category) throw AppError("craft_not_found", 404);

    const normalizedCraftId = String(category._id);
    if (crafts.includes(normalizedCraftId) || newCraftIds.includes(normalizedCraftId)) {
      throw AppError("craft_already_exists", 409);
    }
    newCraftIds.push(normalizedCraftId);
  }

  const updated = await repo.update(user._id, {
    crafts: [...crafts, ...newCraftIds],
  });
  return selfProfile(updated);
}

async function resolveOnboardingCrafts(user, onboardingBody) {
  const categories = await catalogRepo.listCategories();
  const categoryMap = new Map();
  categories.forEach((category) => {
    categoryMap.set(String(category._id), String(category._id));
    categoryMap.set(category.slug, String(category._id));
  });
  const resolveCategoryRef = (ref) => categoryMap.get(String(ref)) || String(ref);

  let craftIds = user.crafts || [];
  if (Array.isArray(onboardingBody.crafts)) {
    craftIds = onboardingBody.crafts.map(resolveCategoryRef);
    if (!craftIds.length) throw AppError("crafts_required", 400);
  } else if (!craftIds.length) {
    throw AppError("crafts_required", 400);
  }
  return craftIds;
}

/**
 * Shared onboarding flow: validation, craft resolution, founding member
 * eligibility check, member count snapshotting, and badge assignment.
 * Returns the onboarding patch to merge into the user update, plus the
 * founding member badge (if any) earned as a result.
 */
async function runOnboarding(user, body) {
  if (user.verificationStatus?.email !== "verified") throw AppError("email_unverified", 403);
  const patch = { onboarding: true };
  if (!!!body.skipped) {
    const craftIds = await resolveOnboardingCrafts(user, body);
    patch.crafts = craftIds;
  }
  const awarded = await checkAndAwardBadges(user._id, "founding_member");
  let foundingMemberBadge = awarded.find((entry) => entry.badge?.metric === "founding_member") || null;

  if (!foundingMemberBadge) {
    const existing = await UserBadge.find({ user: user._id, revokedAt: null }).populate("badge").lean();
    const match = existing.find((entry) => entry.badge?.metric === "founding_member");
    if (match) foundingMemberBadge = { badge: match.badge, userBadge: match };
  }

  return { patch, foundingMemberBadge };
}

async function patchMe(userId, body = {}) {
  const user = await requireUser(userId);
  const patch = {};

  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.bio !== undefined) {
    const bio = String(body.bio);
    patch.bio = bio;
  }
  const profileIcon = body.profileIcon !== undefined ? body.profileIcon : body.imageUrl;
  if (profileIcon !== undefined) {
    if (!profileIcon || typeof profileIcon !== "string") {
      throw AppError("profile_icon_required", 400);
    }
    patch.profileIcon = profileIcon.trim();
  }
  if (body.coverImage !== undefined) {
    if (!body.coverImage || typeof body.coverImage !== "string") {
      throw AppError("cover_image_required", 400);
    }
    patch.coverImage = body.coverImage.trim();
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

  if (body.crafts !== undefined) {
    if (!Array.isArray(body.crafts)) throw AppError("crafts_invalid", 400);
    patch.crafts = body.crafts.map(String);
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

  let foundingMemberBadge = null;
  if (body.fromOnboarding === true) {
    const result = await runOnboarding(user, body);
    Object.assign(patch, result.patch);
    foundingMemberBadge = result.foundingMemberBadge;
  }

  const updated = await repo.update(user._id, patch);
  const profile = selfProfile(updated);
  if (foundingMemberBadge) {
    profile.earnedBadge = {
      badge: foundingMemberBadge.badge,
      memberCount: foundingMemberBadge.userBadge?.memberCount,
      earnedAt: foundingMemberBadge.userBadge?.earnedAt,
    };
  }
  return profile;
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

module.exports = {
  getMe,
  addCraft,
  patchMe,
  addPortfolioItem,
  deletePortfolioItem,
  patchPrivacy,
  softDeleteMe,
  runOnboarding,
  AppError,
  MAX_PORTFOLIO,
};
