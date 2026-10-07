// controllers/supportController.js
const SupportRequest = require("@SupportRequestModel");
const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@helperUtils/responseUtil");

const supportService = require("./supportService");
const { sendUserNotifications } = require("@notificationsUtil");
const { NotificationTypes } = require("@NotificationsModel");
const createSupportRequest = async (req, res) => {
  const { name, email, subject, message } = req.body;
  const validationOptions = {
    rawData: ["name", "email", "subject", "message"],
  };
  if (!validateParams(req, res, validationOptions)) {
    return;
  }
  try {
    const supportRequest = new SupportRequest({
      name,
      email,
      subject,
      message,
      status: "pending",
      user: req.user._id
    });
    await supportRequest.save();
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "support_request",
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

const getSupportRequest = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, status, date, orderSort } = req.query;
  const timezone = req.user.timezone || 'UTC';
  try {
    if (date && !validateParams(req, res, {
      dateFields: {
        date: "YYYY-MM-DD",
      },
    })) return;

    const { supportRequests, meta } = await supportService.getSupportRequest({
      page,
      limit,
      keyword,
      status,
      date,
      orderSort,
      timezone
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "support_requests_fetched_successfully",
      data: supportRequests,
      meta
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};
const deleteSupportRequest = async (req, res) => {
  const { id } = req.params; // Assume the ID of the support request is passed as a URL parameter

  if (!id) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "missing_support_request_id",
    });
  }

  try {
    const result = await SupportRequest.updateOne(
      { _id: id },
      { $set: { status: 'deleted' } }
    );

    if (result.modifiedCount === 0) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "support_request_not_found",
        error: "Support request not found or already deleted",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "support_request_deleted",
      message: "Support request status updated to 'deleted'",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error,
    });
  }
};
const updateSupportRequest = async (req, res) => {
  const { id } = req.params; // Assume the ID of the support request is passed as a URL parameter
  const { response, status = "closed" } = req.body;
  if (!id) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "missing_support_request_id",
    });
  }
  if (!response) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "missing_response_field",
    });
  }

  try {
    const result = await SupportRequest.updateOne(
      { _id: id },
      { $set: { status, response } }
    );
    const updatedRecord = await SupportRequest.findById(id);


    if (result.modifiedCount === 0) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "support_request_not_found",
        error: "Support request not found or already deleted",
      });
    }
    await sendUserNotifications({
      recipientIds: [updatedRecord.user.toString()],
      title: `Support request updated and ${status}`,
      body: `Your support request has been responded to and ${status} by the admin.${response ? ' Response: ' + response : ''}`,
      data: { type: NotificationTypes.SUPPORT_REQUEST, supportRequestId: updatedRecord._id, objectType: "supportrequests" },
      sender: updatedRecord.user,
      objectId: updatedRecord._id,
      image: null,

    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: `support_request_updated_and_${status}`,
      message: `Support request status updated to '${status}' with response`,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error,
    });
  }
};


module.exports = {
  createSupportRequest,
  getSupportRequest,
  deleteSupportRequest,
  updateSupportRequest
};
