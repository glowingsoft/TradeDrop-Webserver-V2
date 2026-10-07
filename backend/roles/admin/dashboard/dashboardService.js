const dashboardRepo = require("./dashboardRepository");


const getDashboard = async ({ timezone, companyCoach }) => {
  const userStats = await dashboardRepo.getUserStats({
    timezone,
    companyCoach,
  });

  return {
    stats: userStats,
  };
};

module.exports = {
  getDashboard,
};
