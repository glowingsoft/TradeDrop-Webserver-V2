const mongoose = require("mongoose");
const { Announcement } = require("../../../models/Announcement");
const { NOTIFICATION_ACTIVITIES } = require("../../../models/Activity");
const { sendUserNotifications } = require("../../../controllers/communicationController");
const { sendResponse, parsePaginationParams, generateMeta } = require("../../../helperUtils/responseUtil");
const { getFilteredUserIds } = require("@backend/controllers/notificationsController");

const AUDIENCE_TYPES = ["everyone", "category", "area", "activity"];

const validateAudience = (res, audience = {}) => {
  const normalizedAudience = {
    type: audience.type || "everyone",
    value: audience.value || "",
  };

  if (!AUDIENCE_TYPES.includes(normalizedAudience.type)) {
    sendResponse({ res, statusCode: 400, translationKey: "invalid_announcement_audience" });
    return null;
  }

  if (normalizedAudience.type !== "everyone" && !normalizedAudience.value) {
    sendResponse({ res, statusCode: 400, translationKey: "announcement_audience_value_required" });
    return null;
  }

  if (normalizedAudience.type === "category" && !mongoose.Types.ObjectId.isValid(normalizedAudience.value)) {
    sendResponse({ res, statusCode: 400, translationKey: "invalid_category_id" });
    return null;
  }

  if (
    normalizedAudience.type === "activity" &&
    !NOTIFICATION_ACTIVITIES.some(({ value }) => value === normalizedAudience.value)
  ) {
    sendResponse({ res, statusCode: 400, translationKey: "invalid_activity_type" });
    return null;
  }

  return normalizedAudience;
};

const getUserAnnouncements = async (req, res) => {
  const { page, limit, skip } = parsePaginationParams(req);
  const userCreatedAt = req.user.createdAt;
  try {
    const announcements = await Announcement.find({
      active: true,
      publishAt: { $ne: null, $gte: userCreatedAt },
      readBy: { $ne: req.user._id },
    })
      .sort({ publishAt: -1, createdAt: -1 })
      .lean();

    const matchingAnnouncements = [];
    const userId = req.user._id.toString();

    for (const announcement of announcements) {
      const { type, value } = announcement.audience;

      if (type === "everyone") {
        matchingAnnouncements.push(announcement);
        continue;
      }

      const recipientIds = await getFilteredUserIds({ type, value });
      if (recipientIds.some((recipientId) => recipientId.toString() === userId)) {
        matchingAnnouncements.push(announcement);
      }
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "announcements_fetched",
      data: matchingAnnouncements.slice(skip, skip + limit),
      meta: generateMeta(page, limit, matchingAnnouncements.length),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server_error", error });
  }
};

const readAnnouncement = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return sendResponse({ res, statusCode: 400, translationKey: "invalid_announcement_id" });
  }

  try {
    const announcement = await Announcement.findByIdAndUpdate(
      id,
      { $addToSet: { readBy: req.user._id } },
      { new: true },
    );

    if (!announcement) {
      return sendResponse({ res, statusCode: 404, translationKey: "announcement_not_found" });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "announcement_marked_read",
      data: announcement,
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server_error", error });
  }
};

const createAnnouncement = async (req, res) => {
  const { title, description, audience, publishAt = null, active = true } = req.body;

  if (!title || !description) {
    return sendResponse({ res, statusCode: 400, translationKey: "title_and_description_required" });
  }

  const normalizedAudience = validateAudience(res, audience);
  if (!normalizedAudience) return;

  try {
    const announcement = await Announcement.create({
      title,
      description,
      audience: normalizedAudience,
      publishAt,
      active,
    });

    // const isPublished = !publishAt || new Date(publishAt) <= new Date();
    // if (active && isPublished) {
    //   const recipientIds = await getFilteredUserIds(normalizedAudience);
    //   if (recipientIds.length > 0) {
    //     await sendUserNotifications({
    //       recipientIds,
    //       title: announcement.title,
    //       body: announcement.description,
    //       data: {
    //         type: "announcement",
    //         objectType: "announcement",
    //         announcementId: announcement._id.toString(),
    //         audience: normalizedAudience.type,
    //       },
    //       sender: req.user._id,
    //       objectId: announcement._id,
    //       meta: { audience: normalizedAudience },
    //     });
    //   }
    // }

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "announcement_created",
      data: announcement,
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server_error", error });
  }
};

const getAnnouncements = async (req, res) => {
  const { page, limit, skip } = parsePaginationParams(req);
  const { active, audienceType } = req.query;
  const query = {};

  if (active !== undefined) query.active = active === "true";
  if (audienceType) query["audience.type"] = audienceType;

  try {
    const [announcements, total] = await Promise.all([
      Announcement.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Announcement.countDocuments(query),
    ]);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "announcements_fetched",
      data: announcements,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server_error", error });
  }
};

const updateAnnouncement = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return sendResponse({ res, statusCode: 400, translationKey: "invalid_announcement_id" });
  }

  const updates = {};
  ["title", "description", "publishAt", "active"].forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });
  if (req.body.audience !== undefined) {
    const audience = validateAudience(res, req.body.audience);
    if (!audience) return;
    updates.audience = audience;
  }

  try {
    const announcement = await Announcement.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });
    if (!announcement) {
      return sendResponse({ res, statusCode: 404, translationKey: "announcement_not_found" });
    }
    return sendResponse({ res, statusCode: 200, translationKey: "announcement_updated", data: announcement });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server_error", error });
  }
};

const deleteAnnouncement = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return sendResponse({ res, statusCode: 400, translationKey: "invalid_announcement_id" });
  }

  try {
    const announcement = await Announcement.findByIdAndDelete(id);
    if (!announcement) {
      return sendResponse({ res, statusCode: 404, translationKey: "announcement_not_found" });
    }
    return sendResponse({ res, statusCode: 200, translationKey: "announcement_deleted" });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server_error", error });
  }
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  getUserAnnouncements,
  readAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};
