const {
  sendResponse,
  parsePaginationParams,
  validateParams,
  generateMeta,
  getReadableErrorMessage,
  convertTimezoneToUtc,
} = require("../../../helperUtils/responseUtil");

const HelpCenterService = require("./helpCenterService");

const createHelpCenter = async (req, res) => {
  let { image, title, article, type } = req.body;

  const userId = req.user._id;
  const timezone = req.user.timezone;

  if (
    !validateParams(req, res, {
      rawData: ["image", "title", "article", "type"],
    })
  )
    return;

  let data = {
    image,
    title,
    article,
    type,
  };
  try {
    const HelpCenter = await HelpCenterService.createHelpCenter(data);
    if (!HelpCenter) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "HelpCenter_creation_failed",
      });
    }
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "HelpCenter_created_successfully",
      data: HelpCenter,
    });
  } catch (error) {
    const readableError = getReadableErrorMessage(error);
    return sendResponse({
      res,
      statusCode: readableError.statusCode,
      translationKey: readableError.message,
      error,
    });
  }
};
const getHelpCenters = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, status = "active", date, range } = req.query;
  try {
    const userId = req.user._id;
    const timezone = req.user.timezone;
    const { HelpCenters, meta } = await HelpCenterService.getHelpCenters({
      timezone,
      page,
      limit,
      keyword,
      status,
      userId,
      date,
      range,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "HelpCenters_fetched_successfully",
      data: HelpCenters,
      meta,
    });
  } catch (error) {
    const readableError = getReadableErrorMessage(error);
    return sendResponse({
      res,
      statusCode: readableError.statusCode,
      translationKey: readableError.message,
      error,
    });
  }
};
const updateHelpCenter = async (req, res) => {
  const { id } = req.params;
  let { image, title, article, type } = req.body;

  const userId = req.user._id;
  const timezone = req.user.timezone;

  let data = {
    image,
    title,
    article,
    type,
  };
  try {
    const updated = await HelpCenterService.updateHelpCenter(id, data);
    if (updated && updated.error) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: updated.error,
      });
    }

    if (!updated) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "help_center_not_found",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "help_center_updated_successfully",
      data: updated,
    });
  } catch (error) {
    const readableError = getReadableErrorMessage(error);
    return sendResponse({
      res,
      statusCode: readableError.statusCode,
      translationKey: readableError.message,
      error,
    });
  }
};

const deleteHelpCenter = async (req, res) => {
  const { id } = req.params;

  if (
    !validateParams(req, res, {
      pathParams: ["id"],
      objectIdFields: ["id"],
    })
  )
    return;

  try {
    const deleted = await HelpCenterService.deleteHelpCenter(id);
    if (!deleted) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "HelpCenter_not_found",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "HelpCenter_deleted_successfully",
    });
  } catch (error) {
    const readableError = getReadableErrorMessage(error);
    return sendResponse({
      res,
      statusCode: readableError.statusCode,
      translationKey: readableError.message,
      error,
    });
  }
};

const getHelpCenterDetails = async (req, res) => {
  const { id } = req.params;


  try {
    const HelpCenter = await HelpCenterService.getHelpCenterDetails(id);
    if (HelpCenter && HelpCenter.error) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: HelpCenter.error,
      });
    }

    if (!HelpCenter ) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "HelpCenter_not_found",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "HelpCenter_fetched_successfully",
      data: HelpCenter,
    });
  } catch (error) {
    const readableError = getReadableErrorMessage(error);
    return sendResponse({
      res,
      statusCode: readableError.statusCode,
      translationKey: readableError.message,
      error,
    });
  }
};



module.exports = {
  createHelpCenter,
  getHelpCenters,
  updateHelpCenter,
  deleteHelpCenter,
  getHelpCenterDetails
};
