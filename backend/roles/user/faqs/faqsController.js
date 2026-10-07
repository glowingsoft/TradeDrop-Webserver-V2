const {
  sendResponse,
  parsePaginationParams,

  getReadableErrorMessage,

} = require("../../../helperUtils/responseUtil");

const FaqsService = require("./faqsService");






const getFaqss = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, status = "active", date, range } = req.query;
  try {


    const userId = req.user._id;
    const timezone = req.user.timezone;
    const { Faqss, meta } = await FaqsService.getFaqss({
        timezone,
      page,
      limit,
      keyword,
      status,
      userId,
      date,
      range
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Faqss_fetched_successfully",
      data: Faqss
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

  getFaqss,


};