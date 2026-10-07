const { getCurrentDateInTimezone } = require("@helperUtils/responseUtil");
const HelpCenterRepo = require("./helpCenterRepository");
const { cache, invalidate } = require("@redisCache");
const {
  formatFavoritesOrganization,
} = require("./formater/formateHelpCenterImage");
const ACTIVE_ADMIN_SETTINGS_CACHE_KEY = "active";

const invalidatehelpCenterScope = async (scope) => {
  await invalidate(`${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`);
};

const createHelpCenter = async (data) => {
  let HelpCenter = await HelpCenterRepo.createHelpCenter(data);
  return HelpCenter;
};
const getHelpCenters = async ({
  timezone,
  page,
  limit,
  keyword=undefined,
  status,
  userId,
  date,
  range,
}) => {

  const skip = limit === 0 ? 0 : (page - 1) * limit;
  const today = getCurrentDateInTimezone({ timezone, isDateOnly: true });

  const result = await cache({
    namespace: "active:helperCenters",
    fetchFn: async () => {
      const { helperCenter, meta } = await HelpCenterRepo.getHelpCenters({
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
      });

      const formatedHelpCenters = helperCenter.map((item) =>
        formatFavoritesOrganization(item)
      );

      return { HelpCenters: formatedHelpCenters, meta };
    },
  });

  let { HelpCenters, meta } = result;


  const escapeRegex = (text) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");


  if (keyword && keyword.trim()) {
    const safeKeyword = escapeRegex(keyword);
    const regex = new RegExp(safeKeyword, "i");

    HelpCenters = HelpCenters.filter((item) => {
      return (
        regex.test(item.title || "") ||
        regex.test(item.description || "")
      );
    });


    meta = {
      ...meta,
      total: HelpCenters.length,
    };
  }

  return { HelpCenters, meta };
};
const updateHelpCenter = async (id, data) => {
  const invalidations = [];
  invalidations.push("helperCenters");
  await Promise.all(
    invalidations.map((scope) => invalidatehelpCenterScope(scope)),
  );
  const HelpCenter = await HelpCenterRepo.findHelpCenterById(id);
  if (!HelpCenter) {
    return { error: "HelpCenter_not_found" };
  }

  // -----------------------------
  // VALIDATIONS
  // -----------------------------

  if (data.discountType) {
    if (HelpCenter.discountType !== data.discountType) {
      if (!data.discountValue) {
        return { error: "discountValue_is_required_when_discountType_changes" };
      }
    }
  }

  // -----------------------------
  // ALLOWED FIELDS
  // -----------------------------
  const allowedFields = ["image", "title", "article", "type"];

  // -----------------------------
  // APPLY UPDATE FIELDS
  // -----------------------------
  const updateData = {};
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updateData[key] = data[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return HelpCenter;
  }

  Object.assign(HelpCenter, updateData);
  await HelpCenter.save();

  return HelpCenter;
};

const deleteHelpCenter = async (id) => {
  if (!id) throw new Error("HelpCenter ID is required");

  const deleted = await HelpCenterRepo.deleteHelpCenter(id);
  return !!deleted;
};
const getHelpCenterDetails = async (id) => {
  const HelpCenter = await HelpCenterRepo.findHelpCenterById(id);
  if (!HelpCenter) {
    return { error: "HelpCenter_not_found" };
  }

  return formatFavoritesOrganization(HelpCenter);
};
module.exports = {
  createHelpCenter,
  getHelpCenters,
  updateHelpCenter,
  deleteHelpCenter,
  getHelpCenterDetails,
};
