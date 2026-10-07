const { getCurrentDateInTimezone } = require("@helperUtils/responseUtil");
const FaqsRepo = require("./faqsRepository");



const getFaqss = async ({ timezone, page, limit, keyword, status, userId,  date, range }) => {
  const skip = limit === 0 ? 0 : (page - 1) * limit;
  const today = getCurrentDateInTimezone({ timezone, isDateOnly: true });
  let { Faqss, meta } = await FaqsRepo.getFaqss({ timezone, page, limit, keyword, status, userId,  date, range, today, skip });

  return {
    Faqss,
    meta
  };
};


module.exports = {

  getFaqss,


};