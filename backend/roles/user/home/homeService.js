const { getCurrentDateInTimezone } = require("@helperUtils/responseUtil");
const homeRepo = require("./homeRepository");

const getHome = async ({
  timezone,
  page,
  limit,
  keyword,
  status,
  userId,
  date,
  range,
  coach,
}) => {
  const skip = limit === 0 ? 0 : (page - 1) * limit;
  const today = getCurrentDateInTimezone({ timezone, isDateOnly: true });
  let { suggestedCoaches } = await homeRepo.getHome({
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
    coach
  });

  return {
    suggestedCoaches
  };
};

module.exports = {
  getHome,
};
