const NotificationPreferences = require("../models/NotificationPreferences");
const {
  sendResponse,
} = require("../helperUtils/responseUtil");
const mongoose = require("mongoose");


// GET notification preferences
const getNotificationPreferences = async (req, res) => {
  try {
    const { _id: userId } = req.user;

    const prefs = await NotificationPreferences.findOne({ userId });

    if (!prefs) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "notification_preferences_not_found",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "notification_preferences_fetched_success",
      data: prefs,
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


// CREATE + UPDATE (UPSERT)
const upsertNotificationPreferences = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const updates = req.body || {};

    const allowedFields = [
      "emailNotifications",
      "pushNotifications",
      "profileViewAlerts",
      "messageAlerts",
    ];

    // sanitize input
    const updatePayload = {};

    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key)) {
        updatePayload[key] = updates[key];
      }
    }

    // optional: reject empty payload
    if (Object.keys(updatePayload).length === 0) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "no_valid_fields_provided",
      });
    }

    // UPSERT operation
    const prefs = await NotificationPreferences.findOneAndUpdate(
      { userId },
      {
        $set: updatePayload,
        $setOnInsert: { userId },
      },
      {
        new: true,
        upsert: true,
      }
    );

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "notification_preferences_saved_success",
      data: prefs,
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


const defaultSetNotificationPreferences = (userId) => {
  NotificationPreferences.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        emailNotifications: true,
        pushNotifications: true,
        profileViewAlerts: true,
        messageAlerts: true,
      },
    },
    {
      upsert: true,
      new: true,
    }
  ).catch((err) => {
    console.error("NotificationPreferences init failed:", err);
  });
}

module.exports = {
  getNotificationPreferences,
  upsertNotificationPreferences,
  defaultSetNotificationPreferences
};