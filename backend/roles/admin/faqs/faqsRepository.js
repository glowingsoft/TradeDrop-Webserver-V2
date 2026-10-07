const Faq = require("@FaqModel");
const {
  buildKeywordQueryFromModels,
} = require("@helperUtils/dbUtils/queryUtil");
const { generateMeta } = require("@helperUtils/responseUtil");
const { cache, invalidate } = require("@redisCache");
const ACTIVE_ADMIN_SETTINGS_CACHE_KEY = "adminSettings:active";
const buildAdminSettingsCacheKey = ({
  scope = "public",
  skip = 0,
  limit = 10,
  date = "",
  status = "",
  keyword = "",
  userId = "",
  type = "",
}) => {
  return `${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}:${skip}:${limit}:${date}:${status}:${keyword}:${userId}:${type}`;
};
const invalidateAdminSettingsScope = async (scope) => {
  await invalidate(`${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`);
};
const createFaqs = async (data) => {
  try {
    const invalidations = [];
    invalidations.push("faqs");
    await Promise.all(
      invalidations.map((scope) => invalidateAdminSettingsScope(scope)),
    );
    const Faqs = new Faq(data);
    await Faqs.save();
    return Faqs;
  } catch (err) {
    throw err;
  }
};

const getFaqss = async ({
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
  type,
}) => {
  const cacheKey = buildAdminSettingsCacheKey({
    scope: "faqs",
    skip,
    limit,
    date,
    status,
    keyword,
    userId,
    type,
  });


  return cache({
    namespace: cacheKey,
    ttl: 86400,

    fetchFn: async () => {


      const pipeline = [];

      if (status) {
        pipeline.push({
          $match: {
            status,
          },
        });
      } else {
        pipeline.push({
          $match: {
            status: { $ne: "deleted" },
          },
        });
      }


      if (date) {
        const start = new Date(date);
        const end = new Date(new Date(date).setDate(start.getDate() + 1));

        pipeline.push({
          $match: {
            createdAt: {
              $gte: start,
              $lt: end,
            },
          },
        });
      }

      if (type) {
        pipeline.push({
          $match: {
            type,
          },
        });
      }

      if (keyword) {
        const keywordMatch = buildKeywordQueryFromModels(
          [{ schema: Faq.schema }],
          keyword,
        );

        if (Object.keys(keywordMatch).length) {
          pipeline.push({
            $match: keywordMatch,
          });
        }
      }

      pipeline.push({
        $sort: {
          createdAt: -1,
        },
      });

      pipeline.push({
        $facet: {
          data: [{ $skip: skip }, ...(limit === 0 ? [] : [{ $limit: limit }])],
          totalFiltered: [
            {
              $count: "count",
            },
          ],
        },
      });


      const result = await Faq.aggregate(pipeline);

      const Faqss = result[0]?.data || [];
      const totalFiltered = result[0]?.totalFiltered?.[0]?.count || 0;

      const countFilter = {
        ...(userId && { userId }),
      };

      const [total, active, inactive] = await Promise.all([
        Faq.countDocuments({
          ...countFilter,
          status: { $ne: "deleted" },
        }),

        Faq.countDocuments({
          ...countFilter,
          status: "active",
        }),

        Faq.countDocuments({
          ...countFilter,
          status: "inactive",
        }),
      ]);

      const meta = generateMeta(page, limit, totalFiltered);

      meta.FaqssCount = {
        total,
        active,
        inactive,
      };

      return {
        Faqss,
        meta,
      };
    },
  });
};

const findFaqsById = async (id) => {
  return Faq.findById(id);
};

const findByIdAndUpdate = async (id, data) => {
  const invalidations = [];
  invalidations.push("faqs");
  await Promise.all(
    invalidations.map((scope) => invalidateAdminSettingsScope(scope)),
  );
  return Faq.findByIdAndUpdate(id, data, { new: true });
};
const deleteFaq = async (id) => {
  const invalidations = [];
  invalidations.push("faqs");
  await Promise.all(
    invalidations.map((scope) => invalidateAdminSettingsScope(scope)),
  );
  return await Faq.findByIdAndDelete(id);
};
module.exports = {
  createFaqs,
  getFaqss,
  findFaqsById,
  findByIdAndUpdate,
  deleteFaq,
};
