// controllers/supportController.js
const SupportRequest = require("../models/SupportRequest");
const {
  sendResponse,
  validateParams,
} = require("../helperUtils/responseUtil");

// Create a new support request
const createSupportRequest = async (req, res) => {
  const { name, subject, message } = req.body;

  const validationOptions = {
    rawData: ["subject", "message"],
  };

  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const supportRequest = new SupportRequest({
      name,
      subject,
      message,
      status: "pending", // Set the default status
      user: req.user._id
    });

   const data= await supportRequest.save();
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "support_request",
      data,
    });
  } catch (error) {
    const statusCode = error.name === "ValidationError" ? 400 : 500;
    const translationKey = error.name === "ValidationError" 
      ? Object.values(error.errors)[0].message 
      : "internal_server";

    return sendResponse({
      res,
      statusCode,
      translationKey,
      error,
    });
  }
};


module.exports = {
  createSupportRequest
};
