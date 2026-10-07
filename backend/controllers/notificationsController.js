const { sendResponse, generateMeta, parsePaginationParams } = require("../helperUtils/responseUtil");
const moment = require("moment-timezone");
const { NotificationExp } = require("../models/Notifications");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { getDistinctAreaLabels } = require("@backend/roles/admin/usersManagement/usersRepository");
const Category = require("@models/Category");
const { User } = require("../models/UserModel");
const { sendUserNotifications } = require("./communicationController");
const { NotificationTypes } = require("../models/Notifications");
const { NOTIFICATION_ACTIVITIES } = require("@models/Activity");

const getNotifications = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const keyword = req.query.keyword || null;
  const userId = req.user._id;
  const timezone = req.user.timezone || "UTC";

  try {
    const query = { receiverId: userId };
    if (keyword) query.type = { $regex: keyword, $options: "i" };

    const [notifications, total] = await Promise.all([
      NotificationExp.find(query)
        .select("_id type objectId objectType title body isRead subjectId image createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NotificationExp.countDocuments(query),
    ]);

    if (!notifications.length) {
      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "notifications_fetched_success",
        data: [],
        meta: generateMeta(page, limit, total),
      });
    }

    const formatted = notifications.map((n) => {
      return {
        _id: n._id,
        type: n.type,
        objectId: n.objectId,
        objectType: n.objectType,
        title: n.title,
        body: n.body,
        isRead: n.isRead,
        subjectId: n.subjectId,

        image: getFullImageUrl(n.image),
        timeSince: moment(n.createdAt).tz(timezone).fromNow(),
        createdAt: n.createdAt,
      };
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "notifications_fetched_success",
      data: formatted,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "notifications_fetch_error",
      error,
    });
  }
};

// Mark a notification as read by ID
const readNotification = async (req, res) => {
  try {
    const notification = await NotificationExp.findOneAndUpdate(
      { _id: req.params.id, receiverId: req?.user?._id, isRead: false, isDeleted: false },
      { isRead: true },
      { new: true },
    );
    if (!notification) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "notification_not_found_or_already_read",
      });
    }
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "notification_marked_read_success",
      data: notification,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "notification_mark_read_error",
      error,
    });
  }
};

const getAudienceSegments = async (req, res) => {
  try {
    const [ctgryData, areaData] = await Promise.allSettled([
      Category.find({ status: "active" }, { _id: 1, name: 1 }).lean(),
      getDistinctAreaLabels(),
    ]);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "success",
      data: {
        categories: ctgryData?.value,
        areas: areaData?.value,
        activities: NOTIFICATION_ACTIVITIES,
      },
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "error",
      error,
    });
  }
};
const getFilteredUserIds = async ({ type, value }) => {
  const filter = {
    "accountState.userType": "user",
    "accountState.status": "active",
  };

  switch (type) {
    case "everyone":
      return User.distinct("_id", filter);
    case "category":
      if (!value) throw new Error("notification_value_required");
      filter.crafts = value;
      break;
    case "area":
      if (!value) throw new Error("notification_value_required");
      filter.areaLabel = value;
      break;
    case "activity":
      if (!value) throw new Error("notification_value_required");
      break;
    default:
      throw new Error("invalid_notification_type");
  }

  const now = new Date();

  if (type === "activity") {
    if (value === "active_last_7_days") {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      filter.lastSeenAt = { $gte: sevenDaysAgo };
    } else if (value === "inactive_last_30_days") {
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filter.lastSeenAt = { $lt: thirtyDaysAgo, $ne: null };
    } else if (value === "last_7_new_signups") {
      return User.find(filter).sort({ createdAt: -1 }).limit(7).distinct("_id");
    } else {
      throw new Error("invalid_notification_activity");
    }
  }

  return User.distinct("_id", filter);
};

const sendNotificationBySegments = async (req, res) => {
  const { title, body, type, value, data = {}, image = null } = req.body;
  if (!title || !body || !type) {
    return sendResponse({ res, statusCode: 400, translationKey: "notification_title_body_type_required" });
  }
  try {
    const recipientIds = await getFilteredUserIds({ type, value });
    if (!recipientIds.length) {
      return sendResponse({ res, statusCode: 404, translationKey: "no_users_found_for_segment" });
    }
    await sendUserNotifications({
      recipientIds,
      title,
      body,
      data: { ...data, type: NotificationTypes.ANNOUNCEMENT, objectType: "announcement" },
      sender: req.user._id,
      meta: { type, value },
      image,
    });
    return sendResponse({
      res,
      statusCode: 202,
      translationKey: "notification_delivery_started",
      data: { recipientCount: recipientIds.length },
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "notification_send_error", error });
  }
};

module.exports = {
  getNotifications,
  readNotification,
  getAudienceSegments,
  sendNotificationBySegments,
  getFilteredUserIds,
};
