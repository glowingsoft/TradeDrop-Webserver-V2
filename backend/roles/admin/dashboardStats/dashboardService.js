const moment = require("moment-timezone");
const { User } = require("@UsersModel");
const { Drop } = require("@models/Drop");
const TapIn = require("@models/TapIn");
const { Activity } = require("@models/Activity");
const RANGE_DAYS = { last_7_days: 7, last_30_days: 30, last_90_days: 90, last_12_months: 365 };
const countFor = (rows, key) => rows.find((row) => row._id === key)?.count || 0;
const percent = (value, total) => (total ? Math.round((value / total) * 1000) / 10 : 0);
function getRange(range, timezone) {
  const normalizedRange = RANGE_DAYS[range] ? range : "last_7_days";
  const validTimezone = moment.tz.zone(timezone) ? timezone : "UTC";
  const end = moment.tz(validTimezone).endOf("day");
  const start =
    normalizedRange === "last_12_months"
      ? end.clone().subtract(11, "months").startOf("month")
      : end
          .clone()
          .subtract(RANGE_DAYS[normalizedRange] - 1, "days")
          .startOf("day");
  return { range: normalizedRange, timezone: validTimezone, start: start.toDate(), end: end.toDate() };
}
function buildTimeline(rows, { start, end, timezone, range }, valueKeys) {
  const unit = range === "last_12_months" ? "month" : "day";
  const format = unit === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const labels = unit === "month" ? "MMM YYYY" : "MMM D";
  const rowByBucket = new Map(rows.map((row) => [row._id, row]));
  const cursor = moment(start).tz(timezone).startOf(unit);
  const last = moment(end).tz(timezone).startOf(unit);
  const result = [];
  while (cursor.isSameOrBefore(last)) {
    const bucket = cursor.format(format);
    const row = rowByBucket.get(bucket) || {};
    result.push({
      bucket,
      label: cursor.format(labels),
      ...Object.fromEntries(valueKeys.map((key) => [key, row[key] || 0])),
    });
    cursor.add(1, unit);
  }
  return result;
}
/** * TradeDrop admin dashboard statistics. * * Data sources: * - Users * - Drops * - TapIns * - Activity * * TapIn lifecycle based on the actual schema: * * pending * -> inprogress * -> completed * * Other terminal states: * declined * withdrawn * deleted */

async function getDashboardStats({ range, timezone, activityLimit = 8 } = {}) {
  const dateRange = getRange(range, timezone);
  const { start, end } = dateRange;
  const inRange = { createdAt: { $gte: start, $lte: end } };
  const dateFormat = dateRange.range === "last_12_months" ? "%Y-%m" : "%Y-%m-%d";
  const liveUser = { deletedAt: null, "accountState.userType": "user" };
  const visibleDrop = { deletedAt: null, status: { $ne: "deleted" } };
  const visibleTapIn = { deletedAt: null, status: { $ne: "deleted" } };
  const userQuery = User.aggregate([
    {
      $facet: {
        /** * Total users are NOT restricted by date range. */

        totals: [
          { $match: liveUser },
          {
            $group: {
              _id: null,
              users: { $sum: 1 },
              activeUsers: { $sum: { $cond: [{ $eq: ["$accountState.status", "active"] }, 1, 0] } },
            },
          },
        ],
        /** * User creation trend. * * Only users created during the selected range * are included. */

        trends: [
          { $match: { ...liveUser, ...inRange } },
          {
            $group: {
              _id: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: dateRange.timezone } },
              activeUsers: { $sum: { $cond: [{ $eq: ["$accountState.status", "active"] }, 1, 0] } },
              deactivatedUsers: { $sum: { $cond: [{ $ne: ["$accountState.status", "active"] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ]);
  const dropQuery = Drop.aggregate([
    {
      $facet: {
        /** * Current drop status totals. * * Not restricted by date range. */

        statuses: [{ $match: visibleDrop }, { $group: { _id: "$status", count: { $sum: 1 } } }],
        /** * Deleted/hidden drops. * * We intentionally do NOT use visibleDrop here. */
        hidden: [{ $match: { $or: [{ status: "deleted" }, { deletedAt: { $ne: null } }] } }, { $count: "count" }],
        /** * New drops created in selected range. */
        postedInRange: [{ $match: { ...visibleDrop, ...inRange } }, { $count: "count" }],
        /** * Drop timeline. */
        timeline: [
          { $match: { ...visibleDrop, ...inRange } },
          {
            $group: {
              _id: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: dateRange.timezone } },
              newDrops: { $sum: 1 },
              completedDrops: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            },
          },
        ],
        /** * Top categories. */
        topCategories: [
          { $match: { ...visibleDrop, ...inRange } },
          { $project: { categoryIds: ["$needCategoryId", "$offerCategoryId"] } },
          { $unwind: "$categoryIds" },
          { $group: { _id: "$categoryIds", drops: { $sum: 1 } } },
          { $sort: { drops: -1, _id: 1 } },
          { $limit: 6 },
          { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "category" } },
          { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              categoryId: "$_id",
              name: { $ifNull: ["$category.name", "Uncategorized"] },
              drops: 1,
            },
          },
        ],
        /** * Top areas. */
        topAreas: [
          { $match: { ...visibleDrop, ...inRange } },
          { $match: { areaLabel: { $type: "string", $ne: "" } } },
          { $group: { _id: "$areaLabel", drops: { $sum: 1 } } },
          { $sort: { drops: -1, _id: 1 } },
          { $limit: 6 },
          { $project: { _id: 0, area: "$_id", drops: 1 } },
        ],
      },
    },
  ]);
  /** * --------------------------------------------------------- * TAPIN QUERY * --------------------------------------------------------- * * IMPORTANT: * * Actual schema statuses are: * * pending * inprogress * declined * withdrawn * deleted * completed * * Therefore we do NOT query: * * in_progress * completion_proposed * * because those values are not in the provided schema. */
  const tapInQuery = TapIn.aggregate([
    {
      $facet: {
        /** * All visible tap-ins. */
        total: [{ $match: visibleTapIn }, { $count: "count" }],
        /** * Tap-ins created in selected range. */
        sentInRange: [{ $match: { ...visibleTapIn, ...inRange } }, { $count: "count" }],
        /** * Status counts. */
        statuses: [{ $match: visibleTapIn }, { $group: { _id: "$status", count: { $sum: 1 } } }],
        /** * Trades started in selected range. * * A trade is considered started when TapIn is: * * inprogress OR completed */
        tradesStartedInRange: [
          { $match: { ...visibleTapIn, ...inRange, status: { $in: ["inprogress", "completed"] } } },
          { $count: "count" },
        ],
        /** * Completed trades during selected range. * * There is no top-level completedAt in the supplied * TapIn schema. * * We use applicantJob.completedAt OR * ownerJob.completedAt. */
        completedInRange: [
          {
            $match: {
              ...visibleTapIn,
              status: "completed",
              $or: [
                { "ownerJob.completedAt": { $gte: start, $lte: end } },
                { "applicantJob.completedAt": { $gte: start, $lte: end } },
              ],
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);
  /** * --------------------------------------------------------- * ACTIVITY QUERY * --------------------------------------------------------- */
  const activityQuery = Activity.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(activityLimit) || 8, 1), 20))
    .populate("user", "name handle areaLabel avatarUrl profileIcon")
    .populate("drop", "ownerHandle")
    .lean();
  /** * --------------------------------------------------------- * RUN QUERIES * --------------------------------------------------------- * * We still use Promise.allSettled so independent queries * can be diagnosed separately, BUT we no longer silently * turn failures into zeros. */
  const [userResult, dropResult, tapInResult, activityResult] = await Promise.allSettled([
    userQuery,
    dropQuery,
    tapInQuery,
    activityQuery,
  ]);
  /** * Fail loudly if any dashboard query failed. * * This prevents an aggregation/database error from being * returned to frontend as fake zero statistics. */
  const dashboardErrors = [];
  if (userResult.status === "rejected") {
    dashboardErrors.push({ source: "users", error: userResult.reason });
  }
  if (dropResult.status === "rejected") {
    dashboardErrors.push({ source: "drops", error: dropResult.reason });
  }
  if (tapInResult.status === "rejected") {
    dashboardErrors.push({ source: "tapIns", error: tapInResult.reason });
  }
  if (activityResult.status === "rejected") {
    dashboardErrors.push({ source: "activity", error: activityResult.reason });
  }
  if (dashboardErrors.length) {
    console.error("TradeDrop dashboard query errors:", dashboardErrors);
    /** * Don't expose Mongo internals to client. */
    throw new Error("dashboard_statistics_query_failed");
  }
  const userData = userResult.value || [];
  const dropData = dropResult.value || [];
  const tapInData = tapInResult.value || [];
  const activities = activityResult.value || [];
  const users = userData[0] || {};
  const drops = dropData[0] || {};
  const tapIns = tapInData[0] || {};
  /** * --------------------------------------------------------- * USER STATS * --------------------------------------------------------- */
  const totalUsers = users.totals?.[0]?.users || 0;
  const activeUsers = users.totals?.[0]?.activeUsers || 0;
  /** * --------------------------------------------------------- * TAPIN STATS * --------------------------------------------------------- */
  const totalTapIns = tapIns.total?.[0]?.count || 0;
  const tapInsSentInRange = tapIns.sentInRange?.[0]?.count || 0;
  const declinedTapIns = countFor(tapIns.statuses || [], "declined");
  /** * --------------------------------------------------------- * TRADE STATS * --------------------------------------------------------- */
  const completedTrades = countFor(tapIns.statuses || [], "completed");
  const inProgressTrades = countFor(tapIns.statuses || [], "inprogress");
  /** * There is currently no completion_proposed * status in the supplied TapIn schema. * * Keep this at zero until that status is added * to the schema. */
  const awaitingConfirmationTrades = 0;
  /** * Total active trade lifecycle records. * * pending is NOT counted as a started trade. */
  const totalTrades = inProgressTrades + completedTrades;
  /** * --------------------------------------------------------- * DROP STATS * --------------------------------------------------------- */
  const totalDrops = (drops.statuses || []).reduce((sum, item) => sum + item.count, 0);
  const postedInRange = drops.postedInRange?.[0]?.count || 0;
  /** * --------------------------------------------------------- * RANGE TRADE STATS * --------------------------------------------------------- */
  const tradesStartedInRange = tapIns.tradesStartedInRange?.[0]?.count || 0;
  const tradesCompletedInRange = tapIns.completedInRange?.[0]?.count || 0;
  /** * --------------------------------------------------------- * RESPONSE * --------------------------------------------------------- */
  return {
    filter: { range: dateRange.range, timezone: dateRange.timezone, start, end },
    cards: {
      users: totalUsers,
      activeUsers,
      tapInsSent: totalTapIns,
      dropsPosted: totalDrops,
      dropsLive: countFor(drops.statuses || [], "active"),
      dropsCompleted: countFor(drops.statuses || [], "completed"),
      dropsPaused: countFor(drops.statuses || [], "paused"),
      dropsHidden: drops.hidden?.[0]?.count || 0,
    },
    tradeReport: {
      tapIns: totalTapIns,
      tradesStarted: totalTrades,
      completed: completedTrades,
      completionRate: percent(completedTrades, totalTrades),
    },
    tradeActivity: {
      totalTrades,
      completed: { count: completedTrades, percentage: percent(completedTrades, totalTrades) },
      inProgress: { count: inProgressTrades, percentage: percent(inProgressTrades, totalTrades) },
      declined: { count: declinedTapIns, percentage: percent(declinedTapIns, totalTapIns) },
      awaitingConfirmation: {
        count: awaitingConfirmationTrades,
        percentage: percent(awaitingConfirmationTrades, totalTrades),
      },
    },
    charts: {
      drops: buildTimeline(drops.timeline || [], dateRange, ["newDrops", "completedDrops"]),
      users: buildTimeline(users.trends || [], dateRange, ["activeUsers", "deactivatedUsers"]),
    },
    topCategories: (drops.topCategories || []).map((item) => ({ ...item, share: percent(item.drops, postedInRange) })),
    topAreas: (drops.topAreas || []).map((item) => ({ ...item, share: percent(item.drops, postedInRange) })),
    recentActivity: activities.map((activity) => ({
      _id: activity._id,
      type: activity.type,
      action: activity.action,
      createdAt: activity.createdAt,
      user: activity.user
        ? {
            _id: activity.user._id,
            name: activity.user.name || "",
            handle: activity.user.handle || "",
            areaLabel: activity.user.areaLabel || "",
            avatarUrl: activity.user.avatarUrl || activity.user.profileIcon || "",
          }
        : null,
      drop: activity.drop ? { _id: activity.drop._id, ownerHandle: activity.drop.ownerHandle || "" } : null,
    })),
    rangeSummary: {
      newDrops: postedInRange,
      tapInsSent: tapInsSentInRange,
      tradesStarted: tradesStartedInRange,
      tradesCompleted: tradesCompletedInRange,
    },
  };
}
module.exports = { getDashboardStats, RANGE_DAYS };
