const { sendResponse, validateParams } = require("../../../helperUtils/responseUtil");
const tapInService = require("./tapInService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const createOnDrop = async (req, res) => {
  const validationOptions = {
    rawData: ["yourOffer", "availability"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await tapInService.createTapIn(req.user._id, req.params.id, req.body);
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "tapin_created",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const listMine = async (req, res) => {
  try {
    const dir = String(req.query.direction || "outgoing").toLowerCase();
    const { data, meta } = await tapInService.listMyTapIns(req.user._id, {
      direction: dir,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "tapins_fetched",
      data,
      meta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const accept = async (req, res) => {
  try {
    const data = await tapInService.acceptTapIn(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "tapin_accepted",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const decline = async (req, res) => {
  try {
    const data = await tapInService.declineTapIn(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "tapin_declined",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const withdraw = async (req, res) => {
  try {
    const data = await tapInService.withdrawTapIn(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "tapin_withdrawn",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const requestJobCompletion = async (req, res) => {
  try {
    const data = await tapInService.requestJobCompletion(req.user._id, req.params.id, req.body || {});
    return sendResponse({ res, statusCode: 200, translationKey: "completion_requested", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const confirmJobCompletion = async (req, res) => {
  try {
    const data = await tapInService.confirmJobCompletion(req.user._id, req.params.id);
    return sendResponse({ res, statusCode: 200, translationKey: "job_completed", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const createReview = async (req, res) => {
  const validationOptions = { rawData: ["stars"] };
  if (!validateParams(req, res, validationOptions)) return;
  try {
    const data = await tapInService.createTapInReview(req.user._id, req.params.id, req.body || {});
    return sendResponse({ res, statusCode: 201, translationKey: "review_created", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const getAll = async (req, res) => {
  try {
    const { data, meta } = await tapInService.getAllTapIns({
      req,
      filter: {},
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "tapins_fetched",
      data,
      meta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createOnDrop,
  listMine,
  accept,
  decline,
  withdraw,
  requestJobCompletion,
  confirmJobCompletion,
  createReview,
  getAll,
};
