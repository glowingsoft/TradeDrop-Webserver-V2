const { Badge } = require("../../../models/Badge");
const { UserBadge } = require("../../../models/UserBadge");
const Trade = require("../../../models/Trade");

const OPERATORS = {
  ">=": (value, threshold) => value >= threshold,
  ">": (value, threshold) => value > threshold,
  "=": (value, threshold) => value === threshold,
  "<=": (value, threshold) => value <= threshold,
  "<": (value, threshold) => value < threshold,
};

const compareByOperator = (value, operator, threshold) => {
  const compare = OPERATORS[operator];
  if (!compare) return false;
  return compare(value, threshold);
};

const METRIC_CALCULATORS = {
  completed_trades: async (userId) => {
    return Trade.countDocuments({
      status: "completed",
      $or: [{ requesterId: userId }, { responderId: userId }],
    });
  },
  founding_member: async (userId) => {
    const badgeIds = await Badge.find({ metric: "founding_member" }).distinct("_id");
    if (!badgeIds.length) return null;
    // Users who already hold the badge keep their original number
    const own = await UserBadge.findOne({ user: userId, badge: { $in: badgeIds } })
      .sort({ earnedAt: 1 })
      .select("memberCount")
      .lean();
    if (own?.memberCount) return own.memberCount;
    const awardedCount = await UserBadge.countDocuments({ badge: { $in: badgeIds }, user: { $ne: userId } });
    return awardedCount + 1;
  },
};

const calculateMetricValue = async (userId, metric) => {
  const calculator = METRIC_CALCULATORS[metric];
  if (!calculator) return null;
  return calculator(userId);
};

/**
 * Evaluates every active badge for the given metric against the user's current
 * metric value and awards any newly-qualifying badges (idempotent via the
 * unique { user, badge } index on UserBadge).
 */
const checkAndAwardBadges = async (userId, metric) => {
  const value = await calculateMetricValue(userId, metric);
  if (value === null || value === undefined) return [];
  const badges = await Badge.find({ metric, status: "active" });
  const eligibleBadges = badges.filter((badge) => compareByOperator(value, badge.operator, badge.threshold));
  if (!eligibleBadges.length) return [];

  const awarded = [];
  for (const badge of eligibleBadges) {
    try {
      const userBadge = await UserBadge.findOneAndUpdate(
        { user: userId, badge: badge._id },
        {
          $setOnInsert: {
            user: userId,
            badge: badge._id,
            earnedAt: new Date(),
            earnedReason: `${metric} ${badge.operator} ${badge.threshold}`,
            memberCount: value,
            awardedBy: null,
          },
        },
        { upsert: true, new: true, rawResult: true },
      );
      // rawResult.lastErrorObject.updatedExisting is false when a new doc was inserted
      if (userBadge?.lastErrorObject && userBadge.lastErrorObject.updatedExisting === false) {
        awarded.push({ badge, userBadge: userBadge.value });
      }
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }

  return awarded;
};

module.exports = {
  compareByOperator,
  calculateMetricValue,
  checkAndAwardBadges,
};
