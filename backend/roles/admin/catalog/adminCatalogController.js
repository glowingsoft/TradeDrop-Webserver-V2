const { sendResponse } = require("../../../helperUtils/responseUtil");
const catalogService = require("../../user/catalog/catalogService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const createOrUpdateCategory = async (req, res) => {
  try {
    const data = await catalogService.createOrUpdateCategory(req.body);
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "category_saved",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const listAllCategories = async (req, res) => {
  try {
    const data = await catalogService.listAllCategories();
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

const getCategories = async (req, res) => {
  try {
    const { data, meta } = await catalogService.getCategories(req);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "categories_fetched",
      data,
      meta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await catalogService.updateCategory(id, req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "category_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (status === undefined) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "status_required",
      });
    }
    const data = await catalogService.updateCategoryStatus(id, status);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "category_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const listTimingChips = async (req, res) => {
  try {
    const data = await catalogService.listTimingChips({ req });
    return sendResponse({ res, statusCode: 200, translationKey: "timing_chips_fetched", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const createTimingChip = async (req, res) => {
  try {
    const data = await catalogService.createTimingChip(req.body);
    return sendResponse({ res, statusCode: 201, translationKey: "timing_chip_created", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateTimingChip = async (req, res) => {
  try {
    const data = await catalogService.updateTimingChip(req.params.id, req.body);
    return sendResponse({ res, statusCode: 200, translationKey: "timing_chip_updated", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const removeTimingChip = async (req, res) => {
  try {
    const data = await catalogService.removeTimingChip(req.params.id);
    return sendResponse({ res, statusCode: 200, translationKey: "timing_chip_removed", data });
  } catch (error) {
    return handleError(res, error);
  }
};

async function updateAppSettings(req, res, next) {
  try {
    const settings = await catalogService.updateAppSettings(req.body);

    return res.status(200).json({
      success: true,
      message: "App settings updated successfully",
      data: settings,
    });
  } catch (error) {
    return next(error);
  }
}

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
  createOrUpdateCategory,
  listAllCategories,
  getCategories,
  updateCategory,
  updateCategoryStatus,
  listTimingChips,
  createTimingChip,
  updateTimingChip,
  removeTimingChip,
  updateAppSettings,
  getAppSettings,
};
