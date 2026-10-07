// communicationController.js
const { sendEmailViaBrevo } = require("../helperUtils/emailUtil");
const { Devices } = require("../models/Devices");
const { sendResponse, validateParams } = require("../helperUtils/responseUtil");
const adminFireBConfig = require("../config/firebaseAdmin"); // Firebase admin SDK setup
const { getFullImageUrl } = require("@helperUtils/imageHelper");

const { NotificationExp } = require("../models/Notifications");
const NotificationPreferences = require("../models/NotificationPreferences");

/**
 * Send an email using AWS SES
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendEmailMailgun = async (req, res) => {
  const { title, emails, subject, body, config } = req.body;
  // Validate required parameters
  const validationOptions = {
    bodyParams: ["title", "emails", "subject", "body"],
  };

  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    await sendEmailViaBrevo(emails, subject, body, config);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "email_sent",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "failed_to_send_email",
      error,
    });
  }
};

/**
 * Send a notification (placeholder function, can be expanded for different titles)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendNotificationControllerForTesting = async (req, res) => {
  const { recipients, title, body, data } = req.body;

  // Validate required parameters
  const validationOptions = {
    bodyParams: ["recipients", "title", "body"],
  };

  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    // Placeholder for notification sending logic
    // This can be expanded to handle different titles of notifications like SMS, Push, etc.
    // logger.log(`Sending ${title} notification to: ${recipients.join(", ")}`);
    // logger.log(`body: ${body}`);

    // Simulate sending notification
    const response = await sendNotification(recipients, {
      title: title,
      body: body,
      data: data,
    });

    const successIds = [];
    const failureIds = [];

    response.responses.forEach((resp, idx) => {
      if (resp.success) {
        successIds.push(recipients[idx]);
      } else {
        failureIds.push({
          ...recipients[idx],
          error: resp.error ? resp.error.message : "Unknown error",
        });
      }
    });

    if (successIds.length > 0) {
      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "notifications_sent_success", // Use the success translation key
        values: { title }, // Pass the dynamic title
        data: {
          successIds,
          failureIds,
        },
      });
    } else {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "notifications_sent_failure", // Use the success translation key
        values: { title }, // Pass the dynamic title
        data: {
          successIds,
          failureIds,
        },
      });
    }
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

/**
 * Sends a notification to multiple users based on their user IDs.
 *
 * @param {Object} param0 - Object containing recipientIds (array), title (string), body (string), and optional data (object).
 */

// Returns recipientIds with push-disabled users removed
const filterPushEnabledRecipients = async (recipientIds) => {
  const disabled = await NotificationPreferences.find({
    userId: { $in: recipientIds },
    pushNotifications: false,
  })
    .select("userId")
    .lean();

  const disabledSet = new Set(disabled.map((p) => p.userId.toString()));
  return recipientIds.filter((id) => !disabledSet.has(id.toString()));
};

const sendUserNotifications = async ({
  recipientIds,
  title,
  body,
  data = {},
  sender = null,
  objectId = null,
  meta = {},
  saveNotification = true,
  image = null,
}) => {
  setImmediate(async () => {
    try {
      recipientIds = await filterPushEnabledRecipients(recipientIds);

      if (!recipientIds?.length) {
        return;
      }
      const notificationsToSave = recipientIds.map((userId) => ({
        type: data.type || "system",
        subjectId: sender,
        objectId,
        objectType: data.objectType || "general",
        receiverId: userId,
        image,
        title,
        body,
        meta,
      }));

      await NotificationExp.insertMany(notificationsToSave);

      return {
        message: "send successfully",
        data: {
          recipientIds: recipientIds?.length,
        },
      };

      const recipientDevices = await Devices.find({
        userId: { $in: recipientIds },
      }).select("userId devices");

      if (!recipientDevices?.length) {
        return;
      }

      const userTokens = new Map();

      recipientDevices.forEach((userDevice) => {
        const userId = userDevice.userId.toString();

        if (!userTokens.has(userId)) {
          userTokens.set(userId, new Set());
        }

        userDevice.devices.forEach((device) => {
          if (device.deviceId) {
            userTokens.get(userId).add(device.deviceId);
          }
        });
      });

      const tokens = [...userTokens.values()].flatMap((tokenSet) => [...tokenSet]);

      if (tokens.length) {
        const dataWithStringValues = Object.fromEntries(
          Object.entries({
            ...data,
            meta: meta || {},
            subjectId: sender ? sender.toString() : "",
            objectId: objectId ? objectId.toString() : "",
            image: getFullImageUrl(image) || "",
            notificationId: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
          }).map(([key, value]) => [
            key,
            value === undefined || value === null
              ? ""
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value),
          ]),
        );

        const payload = {
          notification: {
            title,
            body,
            ...(image ? { image: getFullImageUrl(image) } : {}),
          },
          data: dataWithStringValues,
        };

        const tokenChunks = [];

        for (let i = 0; i < tokens.length; i += 500) {
          tokenChunks.push(tokens.slice(i, i + 500));
        }

        await Promise.all(
          tokenChunks.map((chunk) =>
            adminFireBConfig.messaging().sendEachForMulticast({
              tokens: chunk,
              ...payload,
            }),
          ),
        );
      }

      if (!saveNotification) {
        return;
      }

      // const notificationsToSave = recipientIds.map((userId) => ({
      //   type: data.type || "system",
      //   subjectId: sender,
      //   objectId,
      //   objectType: data.objectType || "general",
      //   receiverId: userId,
      //   image,
      //   title,
      //   body,
      //   meta,
      // }));

      // await NotificationExp.insertMany(notificationsToSave);
    } catch (error) {
      console.error("Error sending notifications in background:", error);
    }
  });
};

const sendNotification = async (recipients, payload) => {
  const androidTokens = [];
  const iosTokens = [];

  // Separate Android and iOS tokens
  recipients.forEach((recipient) => {
    if (recipient.deviceType === "android") {
      androidTokens.push(recipient.deviceId);
    } else if (recipient.deviceType === "ios" || recipient.deviceType === "web") {
      iosTokens.push(recipient.deviceId);
    }
  });
  // const additionalToken = "cYp8RW8gREO3vhzf_nHlCB:APA91bHR17qarpZDNK7SlZw-ybhb7JmHHbBGLZGDdYFh_6XJFPzfCCC0HdrOv3R-N36ZnoUrY_3I0h5-nFONRhIyQV8QRbAqkvdadYPOFB4EIavJUdfyXtTJYcMNoJKSeTZ0noJqLp4k";
  // androidTokens.push(additionalToken);

  // Add a random string as notificationId to payload.data
  const notificationId = Math.floor(1000000000 + Math.random() * 9000000000).toString();

  // Ensure all data values are strings (FCM requirement)
  payload.data = Object.fromEntries(
    Object.entries({
      ...payload.data,
      notificationId: notificationId,
      image: getFullImageUrl(payload.image) || "",
    }).map(([key, value]) => [
      key,
      value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
    ]),
  );

  // Notification payload for Android
  const androidPayload = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data,
  };

  // Notification payload for iOS
  const iosPayload = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          sound: "default", // Use default sound on iOS
          badge: 1, // Optional: set the badge number on the app icon
        },
      },
    },
    data: payload.data, // Optional: add custom data for iOS
  };

  try {
    const promises = [];

    // Send to Android devices
    if (androidTokens.length > 0) {
      const androidPromise = adminFireBConfig.messaging().sendEachForMulticast({
        tokens: androidTokens,
        ...androidPayload,
      });
      promises.push(androidPromise);
    }

    // Send to iOS devices
    if (iosTokens.length > 0) {
      const iosPromise = adminFireBConfig.messaging().sendEachForMulticast({
        tokens: iosTokens,
        ...iosPayload,
      });
      promises.push(iosPromise);
    }

    const responses = await Promise.all(promises);

    const result = {
      responses: [],
    };

    responses.forEach((response) => {
      result.responses = result.responses.concat(response.responses);
    });

    result.responses.forEach((r, index) => {
      if (!r.success) {
        //payload
        // console.error(`❌ FCM Error at index ${index}`);
        // console.error("Code:", r.error?.code);
        // console.error("Message:", r.error?.message);
        // console.error("Stack:", r.error?.stack);
        // console.error("Full Error:", r.error);
      }
    });

    return result;
  } catch (error) {
    // console.error("Error sending notifications:", error);
    throw error;
  }
};

module.exports = {
  sendNotificationControllerForTesting,
  sendUserNotifications,
  sendEmailMailgun,
};
