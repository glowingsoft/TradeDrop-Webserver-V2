const { sendResponse, validateParams } = require("../../../helperUtils/responseUtil");
const profileService = require("./profileService");

function handleError(res, error) {
  return sendResponse({
    res,
    statusCode: error.statusCode || 500,
    translationKey: error.translationKey || "internal_server_error",
    error,
  });
}

const getMe = async (req, res) => {
  try {
    const data = await profileService.getMe(req.user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "profile_fetched",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const patchMe = async (req, res) => {
  try {
    const data = await profileService.patchMe(req.user._id, req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "profile_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const postCraft = async (req, res) => {
  const validationOptions = { rawData: ["craftIds"] };
  if (!validateParams(req, res, validationOptions)) return;
  try {
    const data = await profileService.addCraft(req.user._id, req.body.craftIds);
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "craft_added",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const postPortfolio = async (req, res) => {
  try {
    const { item, profile } = await profileService.addPortfolioItem(req.user._id, req.body);
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "portfolio_item_added",
      data: { item, profile },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const patchPortfolio = async (req, res) => {
  try {
    const data = await profileService.patchPortfolioItem(req.user._id, req.params.id, req.body);
    return sendResponse({ res, statusCode: 200, translationKey: "portfolio_item_updated", data });
  } catch (error) {
    return handleError(res, error);
  }
};

const deletePortfolio = async (req, res) => {
  try {
    const data = await profileService.deletePortfolioItem(req.user._id, req.params.id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "portfolio_item_deleted",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const patchPrivacy = async (req, res) => {
  try {
    const data = await profileService.patchPrivacy(req.user._id, req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "privacy_updated",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const postVerification = async (req, res) => {
  try {
    const data = await profileService.requestVerification(req.user._id, req.body?.note);
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "verification_request_created",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteMe = async (req, res) => {
  try {
    const data = await profileService.softDeleteMe(req.user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "account_deleted",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  getMe,
  patchMe,
  postCraft,
  postPortfolio,
  patchPortfolio,
  deletePortfolio,
  patchPrivacy,
  postVerification,
  deleteMe,
};
