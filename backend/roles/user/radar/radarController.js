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
const getRadarTabs = async (req, res) => {
  try {
    const data = await radarService.listRadarTabs(req);
    return sendResponse({ res, statusCode: 200, translationKey: "radar_fetched", data });
  } catch (error) {
    return handleError(res, error);
  }
};
const getRadarPeople = async (req, res) => {
  try {
    const data = await radarService.listRadarPeople(req);
    return sendResponse({ res, statusCode: 200, translationKey: "radar_fetched", data });
  } catch (error) {
    return handleError(res, error);
  }
};
const getRadarDrops = async (req, res) => {
  try {
    const data = await radarService.listRadarDrops(req);
    return sendResponse({ res, statusCode: 200, translationKey: "radar_fetched", data });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  getRadar,
  getRadarTabs,
  getRadarPeople,
  getRadarDrops,
};
