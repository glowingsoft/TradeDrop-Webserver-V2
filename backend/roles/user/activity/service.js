const Circle = require("@models/Circle");
const CircleMember = require("@models/CircleMember");
const ConnectionRequest = require("@models/ConnectionRequest");
const Event = require("@models/Event");
const TapIn = require("@models/TapIn");
const Trade = require("@models/Trade");
const { Drop } = require("@models/Drop");
const { User } = require("@UsersModel");
const { dropExpiredFilter } = require("../_shared/tradeShared");
const { Favorites } = require("@backend/commonModules/favorites/Favorite");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { idStr } = require("../_shared/serialize");

async function paged(query, model, page, limit, sort = { createdAt: -1 }) {
  const [items, total] = await Promise.all([
    model
      .find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    model.countDocuments(query),
  ]);
  return { items, meta: generateMeta(page, limit, total) };
}

function userViewsById(users) {
  return new Map(
    users.map((user) => [
      String(user._id),
      { _id: idStr(user._id), name: user.name || "", profileIcon: getFullImageUrl(user.profileIcon) },
    ]),
  );
}

function dropViewsById(drops) {
  return new Map(drops.map((drop) => [String(drop._id), { _id: idStr(drop._id), title: drop.title, idea: drop.idea }]));
}

async function received(userId, page, limit) {
  const [invitedIds, organizerCircleIds] = await Promise.all([
    CircleMember.distinct("circleId", { userId, status: "invited" }),
    CircleMember.distinct("circleId", { userId, status: "active", role: "organizer" }),
  ]);
  const circleIds = [...new Set([...invitedIds, ...organizerCircleIds].map(String))];
  const circleItems = circleIds.length
    ? await Circle.find({ deletedAt: null, _id: { $in: circleIds } })
        .select("_id name creatorId")
        .lean()
    : [];
  const circlesById = new Map(circleItems.map((circle) => [String(circle._id), circle]));
  const validOrganizerCircleIds = circleItems
    .filter((circle) => organizerCircleIds.some((id) => String(id) === String(circle._id)))
    .map((circle) => circle._id);
  const validInvitationCircleIds = circleItems
    .filter((circle) => invitedIds.some((id) => String(id) === String(circle._id)))
    .map((circle) => circle._id);
  const incomingCircleFilter = {
    circleId: { $in: validOrganizerCircleIds },
    userId: { $ne: userId },
    status: "pending",
  };
  const invitationFilter = { circleId: { $in: validInvitationCircleIds }, userId, status: "invited" };
  const [
    connections,
    tapIns,
    circleJoinRequests,
    circleInvitations,
    organizerCircles,
    yourDrops,
    draftDropCount,
    draftEventCount,
  ] = await Promise.all([
    paged({ recipientId: userId, status: "pending" }, ConnectionRequest, page, limit),
    paged({ responderId: userId, status: "pending", deletedAt: null }, TapIn, page, limit),
    paged(incomingCircleFilter, CircleMember, page, limit),
    paged(invitationFilter, CircleMember, page, limit),
    Circle.find({ deletedAt: null, _id: { $in: organizerCircleIds } })
      .select("_id")
      .lean(),
    Drop.find({ ownerId: userId, deletedAt: null, status: { $in: ["open", "closed"] } })
      .sort({ updatedAt: -1 })
      .limit(2)
      .select("_id title status date updatedAt")
      .lean(),
    Drop.countDocuments({ ownerId: userId, status: "draft", deletedAt: null }),
    Event.countDocuments({ creatorId: userId, status: "draft" }),
  ]);
  const eventFilter = {
    circleId: { $in: organizerCircles.map((circle) => circle._id) },
    rsvps: { $elemMatch: { status: "pending", userId: { $ne: userId } } },
  };
  const [eventResult] = organizerCircles.length
    ? await Event.aggregate([
        { $match: eventFilter },
        { $unwind: "$rsvps" },
        { $match: { "rsvps.status": "pending", "rsvps.userId": { $ne: userId } } },
        { $sort: { "rsvps.respondedAt": -1, updatedAt: -1, _id: -1, "rsvps.userId": 1 } },
        {
          $facet: {
            items: [
              { $skip: (page - 1) * limit },
              { $limit: limit },
              {
                $project: {
                  _id: 0,
                  requestId: { $concat: [{ $toString: "$_id" }, ":", { $toString: "$rsvps.userId" }] },
                  eventId: { $toString: "$_id" },
                  name: "$name",
                  date: "$date",
                  time: "$time",
                  publicArea: "$publicArea",
                  requesterId: "$rsvps.userId",
                  status: "$rsvps.status",
                  createdAt: "$rsvps.respondedAt",
                },
              },
            ],
            total: [{ $count: "count" }],
          },
        },
      ])
    : [{ items: [], total: [] }];
  const receivedEventRequests = (eventResult?.items || []).map((request) => ({
    ...request,
    requesterId: idStr(request.requesterId),
  }));
  const eventCount = eventResult?.total?.[0]?.count || 0;
  const dropIds = yourDrops.map((drop) => drop._id);
  const tapInCounts = await TapIn.aggregate([
    { $match: { dropId: { $in: dropIds }, status: "pending", deletedAt: null } },
    { $group: { _id: "$dropId", count: { $sum: 1 } } },
  ]);
  const countsByDrop = new Map(tapInCounts.map((row) => [String(row._id), row.count]));
  const latestLimit = page * limit;
  const [latestConnections, latestTapIns, latestCircleJoinRequests, latestCircleInvitations, latestEvents] =
    await Promise.all([
      ConnectionRequest.find({ recipientId: userId, status: "pending" })
        .sort({ createdAt: -1 })
        .limit(latestLimit)
        .lean(),
      TapIn.find({ responderId: userId, status: "pending", deletedAt: null })
        .sort({ createdAt: -1 })
        .limit(latestLimit)
        .lean(),
      CircleMember.find(incomingCircleFilter).sort({ createdAt: -1 }).limit(latestLimit).lean(),
      CircleMember.find(invitationFilter).sort({ createdAt: -1 }).limit(latestLimit).lean(),
      Event.find(eventFilter).sort({ updatedAt: -1 }).limit(latestLimit).lean(),
    ]);
  const latestRequests = [
    ...latestConnections.map((request) => ({
      type: "connection",
      requestId: idStr(request._id),
      requesterId: request.requesterId,
      status: request.status,
      createdAt: request.createdAt,
    })),
    ...latestTapIns.map((request) => ({
      type: "tapIn",
      requestId: idStr(request._id),
      dropId: idStr(request.dropId),
      requesterId: request.requesterId,
      status: request.status,
      createdAt: request.createdAt,
    })),
    ...latestCircleJoinRequests.map((member) => ({
      type: "circle_join_request",
      requestId: idStr(member._id),
      circleId: idStr(member.circleId),
      circleName: circlesById.get(String(member.circleId))?.name || "",
      requesterId: member.userId,
      status: member.status,
      createdAt: member.createdAt,
    })),
    ...latestCircleInvitations.map((member) => ({
      type: "circle_invitation",
      requestId: idStr(member._id),
      circleId: idStr(member.circleId),
      circleName: circlesById.get(String(member.circleId))?.name || "",
      requesterId: member.invitedBy || circlesById.get(String(member.circleId))?.creatorId || null,
      status: member.status,
      createdAt: member.createdAt,
    })),
    ...latestEvents.flatMap((event) =>
      (event.rsvps || [])
        .filter((rsvp) => rsvp.status === "pending" && String(rsvp.userId) !== String(userId))
        .map((request) => ({
          type: "event",
          requestId: `${idStr(event._id)}:${idStr(request.userId)}`,
          eventId: idStr(event._id),
          eventName: event.name,
          requesterId: request.userId,
          status: request.status,
          createdAt: request.respondedAt || event.updatedAt,
        })),
    ),
  ];
  const requesterIds = [
    ...new Set(
      [
        ...latestRequests.map((request) => request.requesterId),
        ...connections.items.map((request) => request.requesterId),
        ...tapIns.items.map((tapIn) => tapIn.requesterId),
        ...circleJoinRequests.items.map((request) => request.userId),
        ...circleInvitations.items.map(
          (invitation) => invitation.invitedBy || circlesById.get(String(invitation.circleId))?.creatorId,
        ),
        ...receivedEventRequests.map((request) => request.requesterId),
      ]
        .map((id) => String(id || ""))
        .filter(Boolean),
    ),
  ];
  const tapInDropIds = [
    ...new Set([...tapIns.items, ...latestTapIns].map((tapIn) => String(tapIn.dropId || "")).filter(Boolean)),
  ];
  const [requesters, tapInDrops] = await Promise.all([
    requesterIds.length
      ? User.find({ _id: { $in: requesterIds } })
          .select("_id name profileIcon")
          .lean()
      : [],
    tapInDropIds.length
      ? Drop.find({ _id: { $in: tapInDropIds } })
          .select("_id title idea")
          .lean()
      : [],
  ]);
  const tapInDropsById = dropViewsById(tapInDrops);
  const requesterById = userViewsById(requesters);
  latestRequests.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return {
    data: {
      connectionRequests: connections.items.map((request) => ({
        ...request,
        requesterId: requesterById.get(String(request.requesterId || "")) || null,
      })),
      tapIns: tapIns.items.map((tapIn) => ({
        ...tapIn,
        requesterId: requesterById.get(String(tapIn.requesterId || "")) || null,
        dropId: tapInDropsById.get(String(tapIn.dropId || "")) || null,
      })),
      circleJoinRequests: circleJoinRequests.items.map((request) => ({
        requestId: idStr(request._id),
        circleId: idStr(request.circleId),
        circleName: circlesById.get(String(request.circleId))?.name || "",
        requesterId: requesterById.get(String(request.userId || "")) || null,
        status: request.status,
        createdAt: request.createdAt,
      })),
      circleInvitations: circleInvitations.items.map((invitation) => ({
        requestId: idStr(invitation._id),
        circleId: idStr(invitation.circleId),
        circleName: circlesById.get(String(invitation.circleId))?.name || "",
        inviterId:
          requesterById.get(
            String(invitation.invitedBy || circlesById.get(String(invitation.circleId))?.creatorId || ""),
          ) || null,
        status: invitation.status,
        createdAt: invitation.createdAt,
      })),
      eventRequests: receivedEventRequests.map((request) => ({
        ...request,
        requesterId: requesterById.get(String(request.requesterId || "")) || null,
      })),
      drafts: { drops: draftDropCount, events: draftEventCount },
      yourDrops: yourDrops.map((drop) => ({
        _id: idStr(drop._id),
        title: drop.title || "",
        status: drop.status,
        date: drop.date || null,
        tapInCount: countsByDrop.get(String(drop._id)) || 0,
      })),
      latestRequests: latestRequests.slice((page - 1) * limit, page * limit).map((request) => ({
        ...request,
        ...(request.type === "tapIn" ? { dropId: tapInDropsById.get(String(request.dropId || "")) || null } : {}),
        requesterId: requesterById.get(String(request.requesterId || "")) || null,
      })),
    },
    meta: {
      connectionRequests: connections.meta,
      tapIns: tapIns.meta,
      circleJoinRequests: circleJoinRequests.meta,
      circleInvitations: circleInvitations.meta,
      eventRequests: generateMeta(page, limit, eventCount),
    },
  };
}

async function sent(userId, page, limit) {
  const [circleRequestIds, invitedCircleIds] = await Promise.all([
    CircleMember.distinct("circleId", { userId, status: { $in: ["pending", "withdrawn"] } }),
    CircleMember.distinct("circleId", { invitedBy: userId, status: "invited" }),
  ]);
  const [requestCircles, invitationCircles] = await Promise.all([
    circleRequestIds.length
      ? Circle.find({ deletedAt: null, _id: { $in: circleRequestIds } })
          .select("_id name")
          .lean()
      : [],
    invitedCircleIds.length
      ? Circle.find({ deletedAt: null, _id: { $in: invitedCircleIds } })
          .select("_id name")
          .lean()
      : [],
  ]);
  const circleRequestFilter = {
    circleId: { $in: requestCircles.map((circle) => circle._id) },
    userId,
    status: { $in: ["pending", "withdrawn"] },
  };
  const invitationFilter = {
    circleId: { $in: invitationCircles.map((circle) => circle._id) },
    invitedBy: userId,
    status: "invited",
  };
  const eventFilter = { "rsvps.userId": userId };
  const [connections, tapIns, circleJoinRequests, circleInvitations, events, eventCount] = await Promise.all([
    paged({ requesterId: userId }, ConnectionRequest, page, limit),
    paged({ requesterId: userId, deletedAt: null }, TapIn, page, limit),
    paged(circleRequestFilter, CircleMember, page, limit),
    paged(invitationFilter, CircleMember, page, limit),
    Event.find(eventFilter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Event.countDocuments(eventFilter),
  ]);
  const circleNamesById = new Map(
    requestCircles.concat(invitationCircles).map((circle) => [String(circle._id), circle.name]),
  );
  const invitationNamesById = new Map(invitationCircles.map((circle) => [String(circle._id), circle.name]));
  const recipientIds = [
    ...new Set(
      [
        ...connections.items.map((request) => request.recipientId),
        ...tapIns.items.map((tapIn) => tapIn.responderId),
        ...circleInvitations.items.map((invitation) => invitation.userId),
      ]
        .map((id) => String(id || ""))
        .filter(Boolean),
    ),
  ];
  const dropIds = [...new Set(tapIns.items.map((tapIn) => String(tapIn.dropId || "")).filter(Boolean))];
  const [recipients, drops] = await Promise.all([
    recipientIds.length
      ? User.find({ _id: { $in: recipientIds } })
          .select("_id name profileIcon")
          .lean()
      : [],
    dropIds.length
      ? Drop.find({ _id: { $in: dropIds } })
          .select("_id title idea")
          .lean()
      : [],
  ]);
  const recipientsById = userViewsById(recipients);
  const dropsById = dropViewsById(drops);
  return {
    data: {
      connectionRequests: connections.items.map((request) => ({
        ...request,
        recipientId: recipientsById.get(String(request.recipientId || "")) || null,
      })),
      tapIns: tapIns.items.map((tapIn) => ({
        ...tapIn,
        dropId: dropsById.get(String(tapIn.dropId || "")) || null,
        responderId: recipientsById.get(String(tapIn.responderId || "")) || null,
      })),
      circleJoinRequests: circleJoinRequests.items.map((request) => ({
        requestId: idStr(request._id),
        circleId: idStr(request.circleId),
        circleName: circleNamesById.get(String(request.circleId)) || "",
        requesterId: idStr(userId),
        status: request.status,
        createdAt: request.createdAt,
      })),
      circleInvitations: circleInvitations.items.map((invitation) => ({
        requestId: idStr(invitation._id),
        circleId: idStr(invitation.circleId),
        circleName: invitationNamesById.get(String(invitation.circleId)) || "",
        recipientId: recipientsById.get(String(invitation.userId || "")) || null,
        status: invitation.status,
        createdAt: invitation.createdAt,
      })),
      eventRequests: events.map((event) => ({
        requestId: `${idStr(event._id)}:${idStr(userId)}`,
        eventId: idStr(event._id),
        name: event.name,
        requesterId: idStr(userId),
        status: event.rsvps.find((rsvp) => String(rsvp.userId) === String(userId))?.status,
      })),
    },
    meta: {
      connectionRequests: connections.meta,
      tapIns: tapIns.meta,
      circleJoinRequests: circleJoinRequests.meta,
      circleInvitations: circleInvitations.meta,
      eventRequests: generateMeta(page, limit, eventCount),
    },
  };
}

async function work(userId, page, limit) {
  const [drops, collaborations, draftCount, savedCount, eventDraftCount] = await Promise.all([
    paged({ ownerId: userId, status: "open", deletedAt: null, ...dropExpiredFilter() }, Drop, page, limit, {
      updatedAt: -1,
    }),
    paged(
      { kind: "collaboration", status: "active", $or: [{ requesterId: userId }, { responderId: userId }] },
      Trade,
      page,
      limit,
      { updatedAt: -1 },
    ),
    Drop.countDocuments({ ownerId: userId, status: "draft", deletedAt: null }),
    Favorites.countDocuments({ user: userId }),
    Event.countDocuments({ creatorId: userId, status: "draft" }),
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
