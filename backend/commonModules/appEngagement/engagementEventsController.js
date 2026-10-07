const {
  sendResponse,
  getReadableErrorMessage,
} = require("../../helperUtils/responseUtil");
const mongoose = require("mongoose");

const engagementService = require("./engagementEventsService");

/**
 * -------------------------------------------------------
 * LOG ENGAGEMENT
 * POST /api/v1/app/engagement/log
 * -------------------------------------------------------
 */
const logEngagement = async (req, res) => {
  try {
    const {
      entityType,
      entityId,
      action,
      eventType,
      ownerUserId,
      anonymousId,
      sessionId,
      metadata,
    } = req.body;

    const userId = req.user?._id || null;

    await engagementService.logEngagementService({
      entityType,
      entityId,
      action,
      eventType,
      userId,
      ownerUserId,
      anonymousId,
      sessionId,
      metadata,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "engagement_logged_successfully",
      data: null,
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

/**
 * -------------------------------------------------------
 * TRENDING
 * GET /api/v1/app/engagement/trending
 * -------------------------------------------------------
 */
const getTrending = async (req, res) => {
  try {
    const {
      entityType,
      eventType,
      action = "profile_view",
      window = "48h",
      limit = 10,
    } = req.query;

    const now = Date.now();
    let since;

    if (window === "48h") {
      since = new Date(now - 48 * 60 * 60 * 1000);
    } else if (window === "7d") {
      since = new Date(now - 7 * 24 * 60 * 60 * 1000);
    } else {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_trending_window",
      });
    }

    const data = await engagementService.getTrendingService({
      entityType,
      eventType,
      action,
      since,
      limit: Number(limit),
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "trending_fetched_successfully",
      data,
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

/**
 * -------------------------------------------------------
 * LEADS (OWNER-BASED)
 * GET /api/v1/app/engagement/leads
 * -------------------------------------------------------
 */
const getLeads = async (req, res) => {
  try {
    const {
      ownerUserId,
      eventTypes,
      since,
      until,
      page = 1,
      limit = 20,
      keyword,
    } = req.query;

    const fallbackOwnerUserId = req.user?._id;

    let effectiveOwnerUserId = ownerUserId || fallbackOwnerUserId;
    const userType = req.user?.userType;
    if(userType === "admin") {
      effectiveOwnerUserId = null;
    }
    if (userType != "admin") {
      if (!mongoose.Types.ObjectId.isValid(effectiveOwnerUserId)) {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "invalid_owner_user_id",
        });
      }
    }

    const parsedEventTypes =
      typeof eventTypes === "string" && eventTypes.length > 0
        ? eventTypes
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined;
    const data = await engagementService.getLeadsByOwnerService({
      ownerUserId: effectiveOwnerUserId,
      eventTypes: parsedEventTypes,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      page: Number(page),
      limit: Number(limit),
      keyword,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "leads_fetched_successfully",
      data,
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
  logEngagement,
  getTrending,
  getLeads,
};
