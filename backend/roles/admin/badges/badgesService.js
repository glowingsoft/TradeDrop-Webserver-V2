const { generateMeta, parsePaginationParams } = require("@helperUtils/responseUtil");
const { Badge, BADGE_METRICS, BADGE_OPERATORS } = require("../../../models/Badge");
const { UserBadge } = require("../../../models/UserBadge");
const { checkAndAwardBadges, calculateMetricValue } = require("./badgeEngine");

function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createBadge = async (body = {}, adminId) => {
  const { name, description = "", icon = "", metric, operator, threshold, status = "active", sortOrder = 0 } = body;

  if (!name || !metric || !operator || threshold === undefined || threshold === null) {
    throw AppError("badge_required_fields_missing", 400);
  }
  if (!BADGE_METRICS.includes(metric)) throw AppError("invalid_badge_metric", 400);
  if (!BADGE_OPERATORS.includes(operator)) throw AppError("invalid_badge_operator", 400);

  const slug = body.slug ? slugify(body.slug) : slugify(name);
  if (!slug) throw AppError("invalid_badge_slug", 400);

  const existing = await Badge.findOne({ slug });
  if (existing) throw AppError("badge_slug_already_exists", 409);

  return Badge.create({
    name: String(name).trim(),
    slug,
    description: String(description || "").trim(),
    icon: String(icon || "").trim(),
    metric,
    operator,
    threshold: Number(threshold),
    status: status === "active" ? "active" : "inactive",
    sortOrder: Number(sortOrder) || 0,
  });
};
const listBadges = async ({ req = {}, filter = {} }) => {
  const { page, limit } = parsePaginationParams(req.query) ?? {
    page: 1,
    limit: 10,
  };

  const { metric, status } = req?.query ?? {};

  const baseMatch = {
    ...filter,

    ...(metric?.trim() && {
      metric: metric.trim(),
    }),
    ...(status?.trim() && {
      status: status.trim(),
    }),
  };

  const match = {
    ...baseMatch,
  };

  const result = await Badge.aggregate([
    {
      $facet: {
        badges: [
          { $match: match },
          {
            $sort: {
              // createdAt: -1,
              sortOrder: 1,
            },
          },
          { $addFields: { icon: { $concat: [process.env.S3_BASE_URL || "", "$icon"] } } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],

        total: [{ $match: match }, { $count: "count" }],
        stats: [
          { $match: baseMatch },
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

  const facetResult = result?.[0] || {};

  const total = facetResult?.total?.[0]?.count || 0;

  const meta = generateMeta(page, limit, total);

  meta.stats = {
    active: facetResult?.stats?.find((item) => item._id === "active")?.count || 0,

    inactive: facetResult?.stats?.find((item) => item._id === "inactive")?.count || 0,
  };

  return {
    data: facetResult?.badges || [],
    meta,
  };
};

const getBadgeById = async (id) => {
  const badge = await Badge.findById(id);
  if (!badge) throw AppError("badge_not_found", 404);
  return badge;
};

const updateBadge = async (id, body = {}, adminId) => {
  const badge = await getBadgeById(id);

  const updates = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = String(body.description).trim();
  if (body.icon !== undefined) updates.icon = String(body.icon).trim();
  if (body.status !== undefined) updates.status = body.status === "active" ? "active" : "inactive";
  if (body.sortOrder !== undefined) updates.sortOrder = Number(body.sortOrder) || 0;

  if (body.metric !== undefined) {
    if (!BADGE_METRICS.includes(body.metric)) throw AppError("invalid_badge_metric", 400);
    updates.metric = body.metric;
  }
  if (body.operator !== undefined) {
    if (!BADGE_OPERATORS.includes(body.operator)) throw AppError("invalid_badge_operator", 400);
    updates.operator = body.operator;
  }
  if (body.threshold !== undefined) updates.threshold = Number(body.threshold);

  if (body.slug !== undefined) {
    const slug = slugify(body.slug);
    if (!slug) throw AppError("invalid_badge_slug", 400);
    if (slug !== badge.slug) {
      const existing = await Badge.findOne({ slug, _id: { $ne: badge._id } });
      if (existing) throw AppError("badge_slug_already_exists", 409);
    }
    updates.slug = slug;
  }

  updates.updatedBy = adminId || null;

  Object.assign(badge, updates);
  await badge.save();
  return badge;
};

const deleteBadge = async (id) => {
  const badge = await getBadgeById(id);
  await Badge.deleteOne({ _id: badge._id });
  await UserBadge.deleteMany({ badge: badge._id });
  return true;
};

const listUserBadges = async (userId) => {
  const userBadges = await UserBadge.find({ user: userId }).populate("badge").sort({ earnedAt: -1 }).lean();
  const hasFoundingMemberBadge = userBadges.some((userBadge) => userBadge.badge?.metric === "founding_member");
  if (!hasFoundingMemberBadge) return userBadges;

  const currentNumber = await calculateMetricValue(userId, "founding_member");
  return userBadges.map((userBadge) => {
    if (userBadge.badge?.metric !== "founding_member") return userBadge;
    return {
      ...userBadge,
      icon: process.env.S3_BASE_URL + userBadge.badge?.icon,
      badge: { ...userBadge.badge, currentNumber },
    };
  });
};

const awardBadgeToUser = async (userId, badgeId, adminId) => {
  const badge = await getBadgeById(badgeId);

  try {
    const userBadge = await UserBadge.create({
      user: userId,
      badge: badge._id,
      earnedAt: new Date(),
      earnedReason: "manually_awarded",
      awardedBy: adminId || null,
    });
    return userBadge;
  } catch (error) {
    if (error.code === 11000) throw AppError("badge_already_awarded", 409);
    throw error;
  }
};

const revokeBadgeFromUser = async (userId, badgeId) => {
  const result = await UserBadge.findOneAndDelete({ user: userId, badge: badgeId });
  if (!result) throw AppError("user_badge_not_found", 404);
  return true;
};

module.exports = {
  createBadge,
  listBadges,
  getBadgeById,
  updateBadge,
  deleteBadge,
  listUserBadges,
  awardBadgeToUser,
  revokeBadgeFromUser,
  checkAndAwardBadges,
  AppError,
};
