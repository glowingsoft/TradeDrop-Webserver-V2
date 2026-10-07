const { sendResponse } = require("../../../helperUtils/responseUtil");
const radarService = require("./radarService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const getRadar = async (req, res) => {
  try {
    const data = await radarService.listRadar({ req });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "radar_fetched",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  getRadar,
};
