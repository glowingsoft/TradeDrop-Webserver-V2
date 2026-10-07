const {
  sendResponse,
  parsePaginationParams,
  getReadableErrorMessage,
} = require("../../../helperUtils/responseUtil");

const homeervice = require("./homeService");

const getHome = async (req, res) => {
  let { page, limit } = parsePaginationParams(req);
  const { keyword, status = "active", date, range, 
    coach } = req.query;
  try {
    const userId = req.user._id;
    const timezone = req.user.timezone;
    const { suggestedCoaches } = await homeervice.getHome({
      timezone,
      page,
      limit,
      keyword,
      status,
      userId,
      date,
      range,
      coach,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Home_fetched_successfully",
      data: suggestedCoaches.suggestedCoaches,
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
  getHome,
};
