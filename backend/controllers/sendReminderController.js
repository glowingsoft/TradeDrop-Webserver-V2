const { sendResponse } = require("../helperUtils/responseUtil");
const {
  sendBookingReminder,
  sendPaymentReminder,
} = require("../roles/user/bookings/bookingsRepository");
const sendReminder = async (req, res) => {
  try {
    const { type, message, booking } = req.body;

    const allowedTypes = [
      "payment-reminder",
      "session-reminder",
      "review-reminder",
    ];

    if (!type) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "type_required",
      });
    }

    if (!allowedTypes.includes(type)) {
      return sendResponse({
        res,
        statusCode: 400,
        message: `Invalid type. Allowed values are: ${allowedTypes.join(", ")}`,
      });
    }

    if (!booking) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "booking_required",
      });
    }

    let reminderResult;

    if (type === "session-reminder") {
      reminderResult = await sendBookingReminder(booking, message);

      if (!reminderResult?.success) {
        return sendResponse({
          res,
          statusCode: 500,
          translationKey: "reminder_not_sent",
          data: reminderResult,
        });
      }
    }
    if (type === "payment-reminder") {
      reminderResult = await sendPaymentReminder(booking, message);

      if (!reminderResult?.success) {
        return sendResponse({
          res,
          statusCode: 500,
          translationKey: "reminder_not_sent",
          data: reminderResult,
        });
      }
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "reminder_sent_success",
      data: reminderResult,
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
  sendReminder,
};
