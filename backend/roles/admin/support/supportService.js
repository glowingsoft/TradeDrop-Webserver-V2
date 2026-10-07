const { getCurrentDateInTimezone } = require("@helperUtils/responseUtil");
const supportRepository = require("./supportRepository");
const getSupportRequest = async ({ timezone, page, limit, keyword, status, userId,  date, range }) => {
  const skip = limit === 0 ? 0 : (page - 1) * limit;
  const today = getCurrentDateInTimezone({ timezone, isDateOnly: true });
  let { supportRequests, meta } = await supportRepository.getSupportRequest({ timezone, page, limit, keyword, status, userId,  date, range, today, skip });

  return {
    supportRequests,
    meta
  };
};
module.exports = {
getSupportRequest
};