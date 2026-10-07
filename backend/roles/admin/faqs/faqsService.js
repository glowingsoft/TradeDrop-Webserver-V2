const { getCurrentDateInTimezone } = require("@helperUtils/responseUtil");
const FaqsRepo = require("./faqsRepository");
const { cache, invalidate } = require("@redisCache");

const ACTIVE_ADMIN_SETTINGS_CACHE_KEY = "adminSettings:active";

const invalidateAdminSettingsScope = async (scope) => {
  await invalidate(`${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`);
};

const invalidateFaqsCache = async () => {
  await invalidateAdminSettingsScope("faqs");
};

const createFaqs = async (data) => {
  const Faqs = await FaqsRepo.createFaqs(data);
  await invalidateFaqsCache();
  return Faqs;
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
  type,
}) => {
  const skip = limit === 0 ? 0 : (page - 1) * limit;
  const today = getCurrentDateInTimezone({ timezone, isDateOnly: true });

  return cache({
    namespace: `${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:faqs`,
    params: {
      page,
      limit,
      keyword: keyword || "",
      status: status || "",
      userId: userId || "",
      date: date || "",
      range: range || "",
      type: type || "",
    },
    ttl: 86400,

    fetchFn: async () => {


      const { Faqss, meta } = await FaqsRepo.getFaqss({
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
      });

      return { Faqss, meta };
    },
  });
};

const updateFaqs = async (id, data) => {
  const Faqs = await FaqsRepo.findFaqsById(id);

  if (!Faqs) {
    return { error: "PromoCode_not_found" };
  }

  const allowedFields = ["question", "answer", "type", "status"];

  const updateData = {};

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updateData[key] = data[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return Faqs;
  }

  Object.assign(Faqs, updateData);
  await Faqs.save();

  await invalidateFaqsCache();

  return Faqs;
};

const deleteFaqs = async (id) => {
  if (!id) throw new Error("FAQ ID is required");

  const deleted = await FaqsRepo.deleteFaq(id);

  if (deleted) {
    await invalidateFaqsCache();
  }

  return !!deleted;
};

module.exports = {
  createFaqs,
  getFaqss,
  updateFaqs,
  deleteFaqs,
};
