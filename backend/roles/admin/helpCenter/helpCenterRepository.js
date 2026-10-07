const HelpCenter = require("@HelpCenterModel");
const {
  buildKeywordQueryFromModels,
} = require("@helperUtils/dbUtils/queryUtil");
const { generateMeta } = require("@helperUtils/responseUtil");
const { cache, invalidate } = require("@redisCache");
const ACTIVE_ADMIN_SETTINGS_CACHE_KEY = "active";
const buildhelpCenterCacheKey = ({ scope }) => {
  return `${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`;
};
const invalidatehelperCentercope = async (scope) => {
  await invalidate(`${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`);
};
const createHelpCenter = async (data) => {
  try {
    const invalidations = [];
    invalidations.push("helperCenters");
    await Promise.all(
      invalidations.map((scope) => invalidatehelperCentercope(scope)),
    );
    const helpCenter = new HelpCenter(data);
    await helpCenter.save();
    return helpCenter;
  } catch (err) {
    throw err;
  }
};

const getHelpCenters = async ({keyword}) => {
  const cacheKey = buildhelpCenterCacheKey({
    scope: "helperCenters",
  });
  const result = await cache({
    namespace: cacheKey,
    ttl: 86400,
    fetchFn: async () => {
      const helperCenter = await HelpCenter.find().sort({ createdAt: -1 });
      return { helperCenter };
    },
  });

  let { helperCenter } = result;

  if (keyword && keyword.trim()) {
    const regex = new RegExp(keyword, "i"); // "i" = case-insensitive

    helperCenter = helperCenter.filter((item) => {
      return regex.test(item.title || "");
    });
  }

  return { helperCenter };
};

const findHelpCenterById = async (id) => {
  return HelpCenter.findById(id);
};

const findByIdAndUpdate = async (id, data) => {
  const invalidations = [];
  invalidations.push("helperCenters");
  await Promise.all(
    invalidations.map((scope) => invalidatehelperCentercope(scope)),
  );
  return HelpCenter.findByIdAndUpdate(id, data, { new: true });
};
const deleteHelpCenter = async (id) => {
  const invalidations = [];
  invalidations.push("helperCenters");
  await Promise.all(
    invalidations.map((scope) => invalidatehelperCentercope(scope)),
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
