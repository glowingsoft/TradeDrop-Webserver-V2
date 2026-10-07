const HelpCenter = require("@HelpCenterModel");
const {
  buildKeywordQueryFromModels,
} = require("@helperUtils/dbUtils/queryUtil");
const { generateMeta } = require("@helperUtils/responseUtil");
const { cache, invalidate } = require("@redisCache");
const ACTIVE_ADMIN_SETTINGS_CACHE_KEY = "helpCenter:active";
const buildhelpCenterCacheKey = ({
  scope = "public", // public | admin
  skip = 0,
  limit = 10,
  date,
  status,
  keyword,
  userId,
}) => {
  return `${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}:skip=${skip}:limit=${limit}:date=${date}:status=${status}:keyword=${keyword}:userId=${userId}`;
};
const invalidatehelpCenterScope = async (scope) => {
  await invalidate(`${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`);
};
const createHelpCenter = async (data) => {
  try {
    const invalidations = ["helpCenter"];
    await Promise.all(
      invalidations.map((scope) => invalidatehelpCenterScope(scope)),
    );

    const helpCenter = new HelpCenter(data);
    await helpCenter.save();
    return helpCenter;
  } catch (err) {
    throw err;
  }
};

const getHelpCenters = async ({
  timezone,
  page,
  limit,
  keyword,
  status,
  userId,
  date,
  range,
  today,
  skip,
}) => {
  const pipeline = [];

  // // Apply filters
  // if (status) {
  //   pipeline.push({ $match: { status } });
  // } else {
  //   pipeline.push({ $match: { status: { $ne: "deleted" } } });
  // }
  const cacheKey = buildhelpCenterCacheKey({
    scope: "helpCenter",
    skip,
    limit,
    date,
    status,
    keyword,
    userId,
  });
  return cache({
    namespace: cacheKey,
    ttl: 86400, // 1 day

    fetchFn: async () => {
      if (date) {
        const start = new Date(date);
        const end = new Date(new Date(date).setDate(start.getDate() + 1));
        pipeline.push({
          $match: {
            createdAt: { $gte: start, $lt: end },
          },
        });
      }

      if (keyword) {
        const keywordMatch = buildKeywordQueryFromModels(
          [{ schema: HelpCenter.schema }],
          keyword,
        );

        if (Object.keys(keywordMatch).length) {
          pipeline.push({ $match: keywordMatch });
        }
      }

      pipeline.push({ $sort: { createdAt: -1 } });

      // Apply pagination + counts using $facet
      pipeline.push({
        $facet: {
          data: [{ $skip: skip }, ...(limit === 0 ? [] : [{ $limit: limit }])],
          totalFiltered: [{ $count: "count" }],
        },
      });

      const result = await HelpCenter.aggregate(pipeline);

      let HelpCenters = result[0]?.data || [];
      const totalFiltered = result[0]?.totalFiltered[0]?.count || 0;

      // Additional counts for meta (active/inactive/total by userId as creator)
      const [total, active, inactive] = await Promise.all([
        HelpCenter.countDocuments({
          ...(userId && { userId: userId }),
          status: { $ne: "deleted" },
        }),
        HelpCenter.countDocuments({
          status: "active",
          ...(userId && { userId: userId }),
        }),
        HelpCenter.countDocuments({
          status: "inactive",
          ...(userId && { userId: userId }),
        }),
      ]);

      const meta = generateMeta(page, limit, totalFiltered);
      meta.HelpCentersCount = { total, active, inactive };
      return { HelpCenters, meta };
    },
  });
};

const findHelpCenterById = async (id) => {
  return HelpCenter.findById(id);
};

const findByIdAndUpdate = async (id, data) => {
  const invalidations = [];
  invalidations.push("HelpCenter");
  await Promise.all(
    invalidations.map((scope) => invalidatehelpCenterScope(scope)),
  );
  return HelpCenter.findByIdAndUpdate(id, data, { new: true });
};
const deleteHelpCenter = async (id) => {
  const invalidations = [];
  invalidations.push("HelpCenter");
  await Promise.all(
    invalidations.map((scope) => invalidatehelpCenterScope(scope)),
  );
  return await HelpCenter.findByIdAndDelete(id);
};
module.exports = {
  createHelpCenter,
  getHelpCenters,
  findHelpCenterById,
  findByIdAndUpdate,
  deleteHelpCenter,
};
