const { sendResponse } = require("../../../helperUtils/responseUtil");
const catalogService = require("./catalogService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const getCategories = async (req, res) => {
  try {
    const data = await catalogService.listCategories();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "categories_fetched",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getTimingChips = async (req, res) => {
  try {
    const data = await catalogService.listTimingChips({ filter: { status: "active" } });
    return sendResponse({ res, statusCode: 200, translationKey: "timing_chips_fetched", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const getCmsBySlug = async (req, res) => {
  try {
    const data = await catalogService.getCmsPage(req.params.slug);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "cms_fetched",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

async function getAppSettings(req, res, next) {
  try {
    const settings = await catalogService.getAppSettings();

    return res.status(200).json({
      success: true,
      message: "App settings fetched successfully",
      data: settings,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getCategories,
  getTimingChips,
  getCmsBySlug,
  getAppSettings,
};
