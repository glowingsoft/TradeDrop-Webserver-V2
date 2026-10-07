const { sendResponse, validateParams } = require("../../../helperUtils/responseUtil");
const dropService = require("./dropService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

function optionalViewerId(req) {
  return req.user?._id || null;
}

const listDrops = async (req, res) => {
  try {
    const { data, meta } = await dropService.listPublic({
      category: req.query.category,
      area: req.query.area,
      timing: req.query.timing,
      cursor: req.query.cursor,
      limit: req.query.limit,
      viewerId: optionalViewerId(req),
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drops_fetched",
      data,
      meta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getDrop = async (req, res) => {
  try {
    const data = await dropService.getDrop(req.params.id, optionalViewerId(req));
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_fetched",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const createDrop = async (req, res) => {
  try {
    const data = await dropService.createDrop(req.user._id, req.body);
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "drop_created",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const patchDrop = async (req, res) => {
  try {
    const data = await dropService.patchDrop(req.user._id, req.params.id, req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const pauseDrop = async (req, res) => {
  try {
    const data = await dropService.updateDropStatus(req.user._id, req.params.id, "paused");
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_status_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const resumeDrop = async (req, res) => {
  try {
    const data = await dropService.updateDropStatus(req.user._id, req.params.id, "active");
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_status_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const completeDrop = async (req, res) => {
  try {
    const data = await dropService.updateDropStatus(req.user._id, req.params.id, "completed");
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_status_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateDropStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "status_required",
      });
    }
    const data = await dropService.updateDropStatus(req.user._id, req.params.id, status);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_status_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteDrop = async (req, res) => {
  try {
    const data = await dropService.softDeleteDrop(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drop_deleted",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const listMyDrops = async (req, res) => {
  try {
    const { data, meta } = await dropService.listMine(req.user._id, {
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "my_drops_fetched",
      data,
      meta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const listAllDrops = async (req, res) => {
  try {
    const { data, meta } = await dropService.getAllDrops({ req });
    // sendTestEmail
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "drops_fetched",
      data,
      meta,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  listDrops,
  listAllDrops,
  getDrop,
  createDrop,
  patchDrop,
  pauseDrop,
  resumeDrop,
  completeDrop,
  updateDropStatus,
  deleteDrop,
  listMyDrops,
};
