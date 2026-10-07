const { sendResponse } = require("@helperUtils/responseUtil");
const dashboardService = require("./dashboardService");

const getDashboardStats = async (req, res) => {
  try {
    const data = await dashboardService.getDashboardStats({
      range: req.query.range,
      timezone: req.query.timezone || req.user?.timezone || "UTC",
      activityLimit: req.query.activityLimit,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "dashboard_fetched_successfully",
      data,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};

module.exports = { getDashboardStats };
