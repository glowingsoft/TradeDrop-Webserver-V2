const { pushBuffer } = require("@redisCache");
const engagementRepo = require("./engagementEventsRepository");
const { getFullImageUrl } = require("@helperUtils/imageHelper");

const LEAD_EVENT_TYPES = [
  "profile_view",
  "package_view",
  "service_view",
  "engaged_click",
  "message",
  "request",
  "profile_save",
];

const HOUR_DEDUPE_EVENT_TYPES = [
  "profile_view",
  "package_view",
  "service_view",
  "engaged_click",
  "message",
  "request",
];

const getHourBucket = (date = new Date()) => {
  const bucket = new Date(date);
  bucket.setMinutes(0, 0, 0);
  return bucket;
};

/**
 * Public API to log engagement
 * Controllers call THIS — never the repo directly
 */
const logEngagementService = async ({
  entityType,
  entityId,
  action,
  eventType,
  userId,
  ownerUserId,
  anonymousId,
  sessionId,
  metadata,
}) => {
  const dedupeHourBucket =
    userId && HOUR_DEDUPE_EVENT_TYPES.includes(eventType)
      ? getHourBucket()
      : null;

  const payload = {
    entityType,
    entityId,
    eventType,
    userId,
    ownerUserId: ownerUserId,
    anonymousId,
    sessionId,
    metadata,
    dedupeHourBucket,
    createdAt: new Date(),
  };

  try {
    // Push into Redis buffer
    await pushBuffer("engagement", payload);
    return true;
  } catch (err) {
    // Fallback → direct Mongo insert
    return engagementRepo.logEngagement(payload);
  }
};

/**
 * Get trending entities (48h / 7d handled upstream)
 */
const getTrendingService = async ({
  entityType,
  eventType,
  action,
  since,
  limit,
}) => {
  return engagementRepo.getTrendingEntities({
    entityType,
    eventType,
    since,
    limit,
  });
};

/**
 * Count engagement for analytics
 */
const countEngagementService = async ({
  entityType,
  entityId,
  eventType,
  action,
  since,
}) => {
  return engagementRepo.countEngagementsByEntity({
    entityType,
    entityId,
    eventType,
    since,
  });
};

const getLeadsByOwnerService = async ({
  ownerUserId,
  eventTypes = LEAD_EVENT_TYPES,
  since,
  until,
  page,
  limit,
  keyword,
}) => {
  const leads = await engagementRepo.getLeadsByOwnerUser({
    ownerUserId,
    eventTypes,
    since,
    until,
    page,
    limit,
    keyword,
  });

  leads.items = Array.isArray(leads?.items)
    ? leads.items.map((lead) => {
        if (lead?.userId) {
          lead.userId.profileIcon = getFullImageUrl(lead.userId.profileIcon)

        }

        if (lead?.ownerUserId) {
          lead.ownerUserId.profileIcon =  getFullImageUrl(lead.ownerUserId.profileIcon)
        }


        return lead;
      })
    : [];

  return leads;
};

module.exports = {
  logEngagementService,
  getTrendingService,
  countEngagementService,
  getLeadsByOwnerService,
  LEAD_EVENT_TYPES,
};
