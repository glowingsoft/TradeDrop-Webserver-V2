const {
  sendResponse,
  validateParams,
} = require("../../../helperUtils/responseUtil");
const tradeService = require("./tradeService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const proposeComplete = async (req, res) => {
  try {
    const data = await tradeService.proposeComplete(
      req.user._id,
      req.params.id,
      req.body || {}
    );
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "completion_proposed",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const confirmComplete = async (req, res) => {
  try {
    const data = await tradeService.confirmComplete(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "trade_completed",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const rejectComplete = async (req, res) => {
  try {
    const data = await tradeService.rejectComplete(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "completion_rejected",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const createReview = async (req, res) => {
  const validationOptions = {
    rawData: ["stars"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await tradeService.createReview(
      req.user._id,
      req.params.id,
      req.body || {}
    );
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "review_created",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  proposeComplete,
  confirmComplete,
  rejectComplete,
  createReview,
};
