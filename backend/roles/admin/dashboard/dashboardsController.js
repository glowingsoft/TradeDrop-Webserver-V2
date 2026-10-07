const {
  sendResponse,
} = require("../../../helperUtils/responseUtil");

const dashboardService = require("./dashboardService");


const getDashboard = async (req, res) => {
  let { timezone } = req.user || "UTC";
  let companyCoach;
  if (req.user.userType === "coach") {
    companyCoach = req.user._id;
  }

  try {
    const dashboard = await dashboardService.getDashboard({
      timezone,
      companyCoach,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "dashboard_fetched_successfully",
      data: dashboard,
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



module.exports = {
  getDashboard,
};
