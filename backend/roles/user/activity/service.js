const Circle = require("@models/Circle");
const ConnectionRequest = require("@models/ConnectionRequest");
const Event = require("@models/Event");
const TapIn = require("@models/TapIn");
const Trade = require("@models/Trade");
const { Drop } = require("@models/Drop");
const { dropExpiredFilter } = require("../_shared/tradeShared");
const { Favorites } = require("@backend/commonModules/favorites/Favorite");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { idStr } = require("../_shared/serialize");

async function paged(query, model, page, limit, sort = { createdAt: -1 }) {
  const [items, total] = await Promise.all([
    model.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    model.countDocuments(query),
  ]);
  return { items, meta: generateMeta(page, limit, total) };
}

async function received(userId, page, limit) {
  const [connections, tapIns, circleItems, circleCount, organizerCircles, latestDrops] = await Promise.all([
    paged({ recipientId: userId, status: "pending" }, ConnectionRequest, page, limit),
    paged({ responderId: userId, status: "pending", deletedAt: null }, TapIn, page, limit),
    Circle.find({
      deletedAt: null,
      $or: [
        {
          $and: [
            { members: { $elemMatch: { userId, status: "active", role: "organizer" } } },
            { members: { $elemMatch: { status: "pending", userId: { $ne: userId } } } },
          ],
        },
        { members: { $elemMatch: { userId, status: "invited" } } },
      ],
    })
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Circle.countDocuments({
      deletedAt: null,
      $or: [
        {
          $and: [
            { members: { $elemMatch: { userId, status: "active", role: "organizer" } } },
            { members: { $elemMatch: { status: "pending", userId: { $ne: userId } } } },
          ],
        },
        { members: { $elemMatch: { userId, status: "invited" } } },
      ],
    }),
    Circle.find({ deletedAt: null, members: { $elemMatch: { userId, role: "organizer", status: "active" } } })
      .select("_id")
      .lean(),
    Drop.find({ ownerId: userId, deletedAt: null })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("_id title status date updatedAt")
      .lean(),
  ]);
  const eventFilter = {
    circleId: { $in: organizerCircles.map((circle) => circle._id) },
    "rsvps": { $elemMatch: { status: "pending", userId: { $ne: userId } } },
  };
  const [eventItems, eventCount] = await Promise.all([
    Event.find(eventFilter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Event.countDocuments(eventFilter),
  ]);
  const receivedEventRequests = eventItems.flatMap((event) =>
    (event.rsvps || [])
      .filter((rsvp) => rsvp.status === "pending" && String(rsvp.userId) !== String(userId))
      .map((request) => ({ eventId: idStr(event._id), name: event.name, userId: idStr(request.userId), status: request.status })),
  );
  const dropIds = latestDrops.map((drop) => drop._id);
  const tapInCounts = await TapIn.aggregate([
    { $match: { dropId: { $in: dropIds }, status: "pending", deletedAt: null } },
    { $group: { _id: "$dropId", count: { $sum: 1 } } },
  ]);
  const countsByDrop = new Map(tapInCounts.map((row) => [String(row._id), row.count]));
  return {
    data: {
      connectionRequests: connections.items,
      tapIns: tapIns.items,
      circleRequests: circleItems.map((circle) => ({
        circleId: idStr(circle._id),
        name: circle.name,
        members: circle.members.filter((member) => String(member.userId) === String(userId) && ["pending", "invited"].includes(member.status)),
      })),
      eventRequests: receivedEventRequests,
      latestDropActivity: latestDrops.map((drop) => ({
        _id: idStr(drop._id),
        title: drop.title || "",
        status: drop.status,
        date: drop.date || null,
        newTapInCount: countsByDrop.get(String(drop._id)) || 0,
      })),
    },
    meta: {
      connectionRequests: connections.meta,
      tapIns: tapIns.meta,
      circleRequests: generateMeta(page, limit, circleCount),
      eventRequests: generateMeta(page, limit, eventCount),
    },
  };
}

async function sent(userId, page, limit) {
  const circleFilter = {
    deletedAt: null,
    members: { $elemMatch: { userId, status: "pending" } },
  };
  const eventFilter = { "rsvps.userId": userId };
  const [connections, tapIns, circles, circleCount, events, eventCount] = await Promise.all([
    paged({ requesterId: userId }, ConnectionRequest, page, limit),
    paged({ requesterId: userId, deletedAt: null }, TapIn, page, limit),
    Circle.find(circleFilter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Circle.countDocuments(circleFilter),
    Event.find(eventFilter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Event.countDocuments(eventFilter),
  ]);
  return {
    data: {
      connectionRequests: connections.items,
      tapIns: tapIns.items,
      circleRequests: circles.map((circle) => ({
        circleId: idStr(circle._id),
        name: circle.name,
        status: circle.members.find((member) => String(member.userId) === String(userId))?.status,
      })),
      eventRsvps: events.map((event) => ({
        eventId: idStr(event._id),
        name: event.name,
        status: event.rsvps.find((rsvp) => String(rsvp.userId) === String(userId))?.status,
      })),
    },
    meta: {
      connectionRequests: connections.meta,
      tapIns: tapIns.meta,
      circleRequests: generateMeta(page, limit, circleCount),
      eventRsvps: generateMeta(page, limit, eventCount),
    },
  };
}

async function work(userId, page, limit) {
  const [drops, collaborations, draftCount, savedCount, eventDraftCount] = await Promise.all([
    paged(
      { ownerId: userId, status: "open", deletedAt: null, ...dropExpiredFilter() },
      Drop,
      page,
      limit,
      { updatedAt: -1 },
    ),
    paged(
      { kind: "collaboration", status: "active", $or: [{ requesterId: userId }, { responderId: userId }] },
      Trade,
      page,
      limit,
      { updatedAt: -1 },
    ),
    Drop.countDocuments({ ownerId: userId, status: "draft", deletedAt: null }),
    Favorites.countDocuments({ user: userId }),
    Event.countDocuments({ creatorId: userId, status: "draft", suggestionStatus: { $ne: "pending" } }),
  ]);
  const openCount = await Drop.countDocuments({
    ownerId: userId,
    status: "open",
    deletedAt: null,
    ...dropExpiredFilter(),
  });
  return {
    data: {
      drops: drops.items,
      collaborations: collaborations.items,
      dropStatistics: { openCount, limit: 2, label: `${openCount} of 2 open` },
      drafts: {
        drops: draftCount,
        events: eventDraftCount,
        savedPeople: savedCount,
        summary: `${savedCount} saved · ${draftCount} Drop${draftCount === 1 ? "" : "s"}, ${eventDraftCount} Event${eventDraftCount === 1 ? "" : "s"} · not published`,
      },
    },
    meta: { drops: drops.meta, collaborations: collaborations.meta },
  };
}

async function getActivity(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const tab = req.params.tab;
  if (tab === "received") return received(userId, page, limit);
  if (tab === "sent") return sent(userId, page, limit);
  if (tab === "work") return work(userId, page, limit);
  const error = new Error("activity_tab_invalid");
  error.statusCode = 400;
  error.translationKey = "activity_tab_invalid";
  throw error;
}

module.exports = { getActivity };
