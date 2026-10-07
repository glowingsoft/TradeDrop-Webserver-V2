// middlewares/roleMiddleware.js
const { sendResponse } = require("../helperUtils/responseUtil");

const roleMiddleware = (allowedRoles) => (req, res, next) => {
  if (allowedRoles.includes(req.user.userType)) {
    next();
  } else {
    sendResponse({
      res,
      statusCode: 403,
      translationKey: `Access denied. ${allowedRoles.join(" or ")} only.`,
      error: `Access denied. ${allowedRoles.join(" or ")} only.`,
    });
  }
};

module.exports = roleMiddleware;

