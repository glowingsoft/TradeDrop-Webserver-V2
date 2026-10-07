
const Faq = require("@FaqModel");
const { buildKeywordQueryFromModels } = require("@helperUtils/dbUtils/queryUtil");
const { generateMeta } = require("@helperUtils/responseUtil");
const { getSuggestedCoaches } = require("../suggestedCoaches/suggestedCoachesService");






const getHome = async ({ timezone, page, limit, keyword, status, userId, date, range, today, skip,coach }) => {

  const [suggestedCoaches] = await Promise.all([
    getSuggestedCoaches({ timezone, page, limit, keyword, status, userId, date, range, today, skip, coach })
  ]);

  return {
    suggestedCoaches,
  };
}
module.exports = {
  getHome,
};