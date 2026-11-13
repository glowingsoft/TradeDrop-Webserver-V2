const mongoose = require("mongoose");
const Circle = require("@models/Circle");
const CircleMember = require("@models/CircleMember");
const Event = require("@models/Event");
const UserReport = require("@models/UserReport");
const BlockedUser = require("@models/BlockedUser");
const { Drop } = require("@models/Drop");
const { User } = require("@UsersModel");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { getConnectionStatuses } = require("@helperUtils/connectionUtil");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { httpError, idStr, isAdminUser } = require("../_shared/serialize");
const { withTransaction } = require("../_shared/tradeShared");
const { getMember, organizerIds, activeMemberIds, circleIdsFor } = require("../circles/membership");

function objectId(id, key = "event_not_found") {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, key);
  return new mongoose.Types.ObjectId(id);
}

async function activeMember(circle, userId, session = null) {
  return getMember(circle._id, userId, { session });
}

async function loadCircle(circleId, session = null) {
  const query = Circle.findOne({ _id: objectId(circleId, "circle_not_found"), deletedAt: null });
  if (session) query.session(session);
  const circle = await query;
  if (!circle) throw httpError(404, "circle_not_found");
  return circle;
}

async function requireOrganizer(circle, userId, session = null) {
  const member = await activeMember(circle, userId, session);
  if (!member || member.role !== "organizer") throw httpError(403, "circle_organizer_required");
}

async function requireEventAccess(event, circle, userId, session = null, isAdmin = false) {
  if (isAdmin) return;
  if (event.audience === "member_only" && !(await activeMember(circle, userId, session))) {
    throw httpError(404, "event_not_found");
  }
}

function validateEventData(body, { publishing = false } = {}) {
  const required = ["name", "date", "time", "publicArea", "exactMeetingPoint"];
  if (publishing) {
    for (const field of required) {
      if (body[field] === undefined || body[field] === null || !String(body[field]).trim()) {
        throw httpError(400, `event_${field}_required`);
      }
    }
  }
  const result = {};
  for (const field of ["name", "purpose", "time", "publicArea", "exactMeetingPoint", "locationLabel"]) {
    if (body[field] !== undefined) result[field] = String(body[field]).trim();
  }
  if (body.date !== undefined) {
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) throw httpError(400, "event_date_invalid");
    result.date = date;
  }
  for (const field of ["audience", "joining"]) {
    if (body[field] === undefined) continue;
    const allowed = field === "audience" ? ["public", "member_only"] : ["immediate", "approval"];
    if (!allowed.includes(body[field])) throw httpError(400, `event_${field}_invalid`);
    result[field] = body[field];
  }
  if (body.capacity !== undefined) {
    if (body.capacity === null || body.capacity === "") result.capacity = null;
    else {
      const capacity = Number(body.capacity);
      if (!Number.isInteger(capacity) || capacity < 1) throw httpError(400, "event_capacity_invalid");
      result.capacity = capacity;
    }
  }
  if (body.lat !== undefined || body.lng !== undefined) {
    if (
      body.lat == null ||
      body.lng == null ||
      String(body.lat).trim() === "" ||
      String(body.lng).trim() === "" ||
      !Number.isFinite(Number(body.lat)) ||
      !Number.isFinite(Number(body.lng)) ||
      Number(body.lat) < -90 ||
      Number(body.lat) > 90 ||
      Number(body.lng) < -180 ||
      Number(body.lng) > 180
    ) {
      throw httpError(400, "event_location_invalid");
    }
    result.lat = Number(body.lat);
    result.lng = Number(body.lng);
    result.location = { type: "Point", coordinates: [result.lng, result.lat] };
  }
  return result;
}

const OPEN_EVENT_LIMIT = 2;

function activeEventFilter(userId) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return {
    creatorId: userId,
    status: "published",
    $or: [{ date: null }, { date: { $gte: startOfToday } }],
  };
}

async function assertEventCapacity(userId, excludeId = null) {
  const filter = activeEventFilter(userId);
  if (excludeId) filter._id = { $ne: excludeId };
  if ((await Event.countDocuments(filter)) >= OPEN_EVENT_LIMIT) throw httpError(409, "open_event_limit");
}

async function listMyActiveEvents(userId) {
  const events = await Event.find(activeEventFilter(userId)).sort({ date: 1, _id: -1 }).lean();
  return events.map((e) => eventView(e, { viewerId: userId }));
}

async function deleteEvent(userId, eventId, isAdmin = false) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  if (!isAdmin) await requireOrganizer(circle, userId);
  if (event.status === "published") throw httpError(409, "event_close_before_delete");
  await Event.deleteOne({ _id: event._id });
  return { deleted: true };
}

async function createEvent(userId, body = {}) {
  const circle = await loadCircle(body.circleId);
  await requireOrganizer(circle, userId);
  const requestedStatus = body.status === undefined ? "draft" : body.status;
  if (!["draft", "publish", "published"].includes(requestedStatus)) {
    throw httpError(400, "event_status_invalid");
  }
  const shouldPublish = requestedStatus !== "draft";
  const fields = validateEventData(body, { publishing: shouldPublish });
  if (shouldPublish) await assertEventCapacity(userId);
  const [event] = await Event.create([
    {
      ...fields,
      circleId: circle._id,
      creatorId: userId,
      rsvps: [{ userId, status: "going", respondedAt: new Date() }],
      status: shouldPublish ? "published" : "draft",
      ...(shouldPublish ? { publishedAt: new Date() } : {}),
    },
  ]);
  if (shouldPublish) await notifyPublishedEvent(event, circle._id, userId);
  return eventView(event, { viewerId: userId });
}

async function suggestEvent(userId, circleId, body = {}) {
  const circle = await loadCircle(circleId);
  if (!(await activeMember(circle, userId))) throw httpError(403, "circle_membership_required");
  const eventName = String(body.name || "").trim();
  if (!eventName) throw httpError(400, "event_name_required");
  if (eventName.length > 160) throw httpError(400, "event_name_invalid");
  const creatorId = String(circle.creatorId);
  const notificationSent = creatorId !== String(userId);
  if (notificationSent) {
    sendUserNotifications({
      recipientIds: [creatorId],
      sender: userId,
      title: "Event suggestion",
      body: `A Circle member suggested "${eventName}" for ${circle.name}.`,
      data: { type: "event_suggestion", objectType: "circle", eventName },
      objectId: circle._id,
    });
  }
  return { circleId: idStr(circle._id), eventName, notificationSent };
}

function eventView(event, { viewerId = null, attendeeDetails = false, allAttendees = false } = {}) {
  const data = {
    _id: idStr(event._id),
    circleId: idStr(event.circleId),
    creatorId: idStr(event.creatorId),
    name: event.name,
    purpose: event.purpose || "",
    date: event.date || null,
    time: event.time || "",
    publicArea: event.publicArea || "",
    exactMeetingPoint: event.exactMeetingPoint || "",
    location: event.location || null,
    lat: event.lat ?? null,
    lng: event.lng ?? null,
    audience: event.audience,
    joining: event.joining,
    capacity: event.capacity ?? null,
    status: event.status,
    rsvpCount: (event.rsvps || []).filter((rsvp) => rsvp.status === "going").length,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
  const ownRsvp = (event.rsvps || []).find((rsvp) => String(rsvp.userId) === String(viewerId));
  data.myRsvp = ownRsvp ? { status: ownRsvp.status, showToParticipants: ownRsvp.showToParticipants } : null;
  if (attendeeDetails) {
    data.attendees = (event.rsvps || [])
      .filter((rsvp) => rsvp.status === "going" && (allAttendees || rsvp.showToParticipants))
      .map((rsvp) => ({ userId: idStr(rsvp.userId), showToParticipants: rsvp.showToParticipants === true }));
  }
  return data;
}

async function updateEvent(userId, eventId, body = {}) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  const user = await User.findById(userId).lean();
  if (!isAdminUser(user)) await requireOrganizer(circle, userId);
  if (event.status === "cancelled") throw httpError(409, "invalid_status_transition");
  const fields = validateEventData(body);
  if (fields.capacity != null && event.rsvps.filter((rsvp) => rsvp.status === "going").length > fields.capacity) {
    throw httpError(409, "event_capacity_below_rsvp_count");
  }
  Object.assign(event, fields);
  await event.save();
  return eventView(event);
}

async function publishEvent(userId, eventId, isAdmin = false) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  if (!isAdmin) await requireOrganizer(circle, userId);
  if (event.status === "published") return eventView(event);
  validateEventData(event.toObject(), { publishing: true });
  await assertEventCapacity(event.creatorId, event._id);
  event.status = "published";
  event.cancelledAt = null;
  event.publishedAt = new Date();
  await event.save();
  await notifyPublishedEvent(event, circle._id, userId);
  return eventView(event);
}

async function notifyPublishedEvent(event, circleId, userId) {
  const memberIds = (await activeMemberIds(circleId)).map((id) => String(id)).filter((id) => id !== String(userId));
  if (memberIds.length) {
    sendUserNotifications({
      recipientIds: memberIds,
      sender: userId,
      title: "New Circle Event",
      body: `${event.name} is now published.`,
      data: { type: "event", objectType: "event" },
      objectId: event._id,
    });
  }
}

async function cancelEvent(userId, eventId, isAdmin = false) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  if (!isAdmin) await requireOrganizer(circle, userId);
  if (event.status === "cancelled") return eventView(event);
  event.status = "cancelled";
  event.cancelledAt = new Date();
  await event.save();
  const participantIds = event.rsvps
    .filter((rsvp) => ["going", "pending", "waitlist"].includes(rsvp.status))
    .map((rsvp) => String(rsvp.userId))
    .filter((id) => id !== String(userId));
  if (participantIds.length) {
    sendUserNotifications({
      recipientIds: [...new Set(participantIds)],
      sender: userId,
      title: "Event cancelled",
      body: `${event.name} was cancelled.`,
      data: { type: "event", objectType: "event" },
      objectId: event._id,
    });
  }
  return eventView(event);
}

async function rsvp(userId, eventId, showToParticipants = false) {
  const eventObjectId = objectId(eventId);
  const result = await withTransaction(async (session) => {
    const event = await Event.findById(eventObjectId).session(session);
    if (!event || event.status !== "published") throw httpError(404, "event_not_found");
    const circle = await loadCircle(event.circleId, session);
    await requireEventAccess(event, circle, userId, session);
    const existingIndex = event.rsvps.findIndex((entry) => String(entry.userId) === String(userId));
    if (existingIndex >= 0 && event.rsvps[existingIndex].status !== "cancelled") {
      throw httpError(409, "event_rsvp_exists");
    }
    const going = event.rsvps.filter((entry) => entry.status === "going").length;
    const status =
      event.capacity != null && going >= event.capacity
        ? "waitlist"
        : event.joining === "approval"
          ? "pending"
          : "going";
    if (existingIndex >= 0) {
      event.rsvps[existingIndex].status = status;
      event.rsvps[existingIndex].showToParticipants = Boolean(showToParticipants);
      event.rsvps[existingIndex].respondedAt = status === "going" ? new Date() : null;
    } else {
      event.rsvps.push({ userId, status, showToParticipants: Boolean(showToParticipants) });
    }
    await event.save({ session });
    return {
      status,
      event: eventView(event, { viewerId: userId }),
      organizerIds: (await organizerIds(circle._id, session)).filter((id) => id !== String(userId)),
    };
  });
  if (result.status === "pending" && result.organizerIds.length) {
    sendUserNotifications({
      recipientIds: result.organizerIds,
      sender: userId,
      title: "Event RSVP request",
      body: "A participant requested to join your Event.",
      data: { type: "event", objectType: "event" },
      objectId: eventObjectId,
    });
  }
  delete result.organizerIds;
  return result;
}

async function decideRsvp(userId, eventId, targetUserId, approve) {
  const result = await withTransaction(async (session) => {
    const event = await Event.findById(objectId(eventId)).session(session);
    if (!event || event.status !== "published") throw httpError(404, "event_not_found");
    const circle = await loadCircle(event.circleId, session);
    await requireOrganizer(circle, userId, session);
    const target = event.rsvps.find((entry) => String(entry.userId) === String(targetUserId));
    if (!target || target.status !== "pending") throw httpError(404, "event_rsvp_not_found");
    const going = event.rsvps.filter((entry) => entry.status === "going").length;
    target.status = approve ? (event.capacity != null && going >= event.capacity ? "waitlist" : "going") : "cancelled";
    target.respondedAt = new Date();
    await event.save({ session });
    return { event, targetUserId: target.userId, status: target.status };
  });
  sendUserNotifications({
    recipientIds: [String(result.targetUserId)],
    sender: userId,
    title: "Event RSVP updated",
    body:
      result.status === "going"
        ? "Your Event RSVP was approved."
        : result.status === "waitlist"
          ? "The Event is full; you are on the waitlist."
          : "Your Event RSVP request was declined.",
    data: { type: "event", objectType: "event" },
    objectId: result.event._id,
  });
  return getEvent(result.event._id, userId);
}

async function cancelRsvp(userId, eventId) {
  const result = await withTransaction(async (session) => {
    const event = await Event.findById(objectId(eventId)).session(session);
    if (!event || event.status !== "published") throw httpError(404, "event_not_found");
    const circle = await loadCircle(event.circleId, session);
    await requireEventAccess(event, circle, userId, session);
    const rsvp = event.rsvps.find((entry) => String(entry.userId) === String(userId));
    if (!rsvp || rsvp.status === "cancelled") throw httpError(404, "event_rsvp_not_found");
    rsvp.status = "cancelled";
    rsvp.respondedAt = new Date();
    await event.save({ session });
    return { event, organizerIds: await organizerIds(circle._id, session) };
  });
  sendUserNotifications({
    recipientIds: result.organizerIds.filter((id) => id !== String(userId)),
    sender: userId,
    title: "Event RSVP cancelled",
    body: "A participant cancelled their Event RSVP.",
    data: { type: "event", objectType: "event" },
    objectId: result.event._id,
  });
  return eventView(result.event, { viewerId: userId });
}

async function listRsvps(userId, eventId, req) {
  const event = await Event.findById(objectId(eventId)).lean();
  if (!event || event.status !== "published") throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  const admin = isAdminUser(req.user);
  await requireEventAccess(event, circle, userId, null, admin);
  const member = admin ? null : await activeMember(circle, userId);
  const canManage = admin || member?.role === "organizer";
  const going = (event.rsvps || []).some(
    (entry) => String(entry.userId) === String(userId) && entry.status === "going",
  );
  if (!canManage && !member && !going) throw httpError(403, "event_attendees_forbidden");

  const { status } = req.query;
  if (status !== undefined && !["going", "pending", "waitlist", "cancelled"].includes(status)) {
    throw httpError(400, "event_rsvp_status_invalid");
  }
  if (!canManage && status && status !== "going") throw httpError(403, "event_attendees_forbidden");
  const entries = (event.rsvps || []).filter(
    (entry) =>
      (!status || entry.status === status) &&
      (canManage || (entry.status === "going" && entry.showToParticipants === true)),
  );
  const { page, limit } = parsePaginationParams(req);
  const selected = entries.slice((page - 1) * limit, page * limit);
  const userIds = selected.map((entry) => entry.userId);
  const [users, relationships, blocks] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("name handle profileIcon")
          .lean()
      : [],
    getConnectionStatuses(userId, userIds),
    userIds.length
      ? BlockedUser.find({
          $or: [
            { blockedBy: userId, blockedUser: { $in: userIds } },
            { blockedBy: { $in: userIds }, blockedUser: userId },
          ],
        })
          .select("blockedBy blockedUser")
          .lean()
      : [],
  ]);
  const profiles = new Map(users.map((user) => [String(user._id), user]));
  const blockedIds = new Set(
    blocks.map((block) =>
      String(block.blockedBy) === String(userId) ? String(block.blockedUser) : String(block.blockedBy),
    ),
  );
  return {
    data: selected.map((entry) => {
      const id = idStr(entry.userId);
      const user = profiles.get(id);
      return {
        userId: id,
        status: entry.status,
        showToParticipants: entry.showToParticipants === true,
        respondedAt: entry.respondedAt || null,
        profile: user
          ? {
              _id: idStr(user._id),
              name: user.name || "",
              handle: user.handle || "",
              profileIcon: user.profileIcon ? getFullImageUrl(user.profileIcon) : "",
            }
          : null,
        ...relationships.get(id),
        ...(blockedIds.has(id) ? { canSendConnectionRequest: false } : {}),
      };
    }),
    meta: generateMeta(page, limit, entries.length),
  };
}

async function getEvent(eventId, userId = null, isAdmin = false) {
  const event = await Event.findById(objectId(eventId)).lean();
  if (!event || event.status !== "published") throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  await requireEventAccess(event, circle, userId, null, isAdmin);
  const memberIds = await activeMemberIds(circle._id);
  const drops = await Drop.find({
    ownerId: { $in: memberIds },
    status: "open",
    deletedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  })
    .select("_id ownerId title date")
    .sort({ createdAt: -1 })
    .lean();
  const isActiveMember = Boolean(userId && (await activeMember(circle, userId)));
  const view = eventView(event, {
    viewerId: userId,
    attendeeDetails:
      isAdmin ||
      Boolean(
        userId &&
        (isActiveMember ||
          event.rsvps.some((rsvp) => String(rsvp.userId) === String(userId) && rsvp.status === "going")),
      ),
    allAttendees: isAdmin,
  });
  const creator = await User.findById(circle.creatorId).select("name profileIcon").lean();
  view.circle = {
    _id: idStr(circle._id),
    name: circle.name,
    creator: creator
      ? {
          _id: idStr(creator._id),
          name: creator.name || "",
          profileIcon: creator.profileIcon ? getFullImageUrl(creator.profileIcon) : "",
        }
      : null,
  };
  const status = view.myRsvp?.status || null;
  const canAccessRsvp = Boolean(userId && (event.audience !== "member_only" || isActiveMember));
  view.viewerRsvp = {
    status,
    hasPlace: status === "going",
    canRsvp: canAccessRsvp && (status === null || status === "cancelled"),
    canCancelRsvp: canAccessRsvp && ["going", "pending", "waitlist"].includes(status),
  };
  if (view.attendees) {
    const attendeeIds = view.attendees.map((attendee) => attendee.userId);
    const attendees = await User.find({ _id: { $in: attendeeIds } })
      .select("name handle profileIcon")
      .lean();
    const byId = new Map(attendees.map((attendee) => [String(attendee._id), attendee]));
    view.attendees = view.attendees.map((attendee) => {
      const profile = byId.get(attendee.userId);
      return {
        ...attendee,
        profile: profile
          ? {
              _id: idStr(profile._id),
              name: profile.name || "",
              handle: profile.handle || "",
              profileIcon: profile.profileIcon ? getFullImageUrl(profile.profileIcon) : "",
            }
          : null,
      };
    });
  }
  view.circleOpenDrops = drops.map((drop) => ({
    _id: idStr(drop._id),
    ownerId: idStr(drop.ownerId),
    title: drop.title || "",
    date: drop.date || null,
  }));
  return view;
}

async function listEvents(req, { excludeUserIds = [] } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const { lat, lng, radius, anywhere, keyword, status } = req.query;
  const match = { status: status || "published", date: { $gte: new Date() } };
  if (keyword?.trim()) match.name = { $regex: escapeRegex(keyword.trim()), $options: "i" };
  if (
    anywhere !== "true" &&
    ((lat === undefined) !== (lng === undefined) ||
      (lat !== undefined && (String(lat).trim() === "" || String(lng).trim() === "")))
  ) {
    throw httpError(400, "event_location_invalid");
  }
  if (radius !== undefined && (!Number.isFinite(Number(radius)) || Number(radius) <= 0)) {
    throw httpError(400, "event_radius_invalid");
  }
  const near = anywhere !== "true" && lat !== undefined && lng !== undefined;
  if (
    near &&
    (String(lat).trim() === "" ||
      String(lng).trim() === "" ||
      !Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lng)) ||
      Number(lat) < -90 ||
      Number(lat) > 90 ||
      Number(lng) < -180 ||
      Number(lng) > 180)
  ) {
    throw httpError(400, "event_location_invalid");
  }
  const pipeline = near
    ? [
        {
          $geoNear: {
            near: { type: "Point", coordinates: [Number(lng), Number(lat)] },
            key: "location",
            distanceField: "distanceMeters",
            maxDistance: Math.max(1, Number(radius) || 50) * 1000,
            spherical: true,
            query: match,
          },
        },
      ]
    : [{ $match: match }];
  const viewerMemberships = req.user?._id
    ? await CircleMember.find({ userId: req.user._id, status: "active" }).select("circleId role").lean()
    : [];
  const memberCircleIds = viewerMemberships.map((member) => member.circleId);
  const viewerRoles = new Map(viewerMemberships.map((member) => [String(member.circleId), member.role]));
  const [result] = await Event.aggregate([
    ...pipeline,
    {
      $lookup: {
        from: "circles",
        localField: "circleId",
        foreignField: "_id",
        as: "circle",
      },
    },
    { $set: { circle: { $first: "$circle" } } },
    ...(excludeUserIds.length ? [{ $match: { "circle.creatorId": { $nin: excludeUserIds } } }] : []),
    {
      $match: {
        "circle.deletedAt": null,
        ...(isAdminUser(req.user)
          ? {}
          : memberCircleIds.length
            ? {
                $or: [
                  { audience: "public", "circle.privacy": { $in: ["open", "approval"] } },
                  { circleId: { $in: memberCircleIds } },
                ],
              }
            : { audience: "public", "circle.privacy": { $in: ["open", "approval"] } }),
      },
    },
    {
      $facet: {
        items: [{ $sort: { date: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);
  const data = (result?.items || []).map((item) => ({
    ...eventView(item, { viewerId: req.user?._id }),
    distanceMeters: item.distanceMeters ?? null,
    viewerRole: viewerRoles.get(String(item.circleId)) || "none",
  }));
  return { data, meta: generateMeta(page, limit, result?.total?.[0]?.count || 0) };
}

const EVENT_LIST_STATUSES = ["upcoming", "cancelled"];

async function listAllEvents(req) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, circleId, audience, status } = req.query;
  if (status !== undefined && !EVENT_LIST_STATUSES.includes(status)) throw httpError(400, "event_status_invalid");
  if (audience !== undefined && !["public", "member_only"].includes(audience)) {
    throw httpError(400, "event_audience_invalid");
  }
  if (circleId !== undefined && !mongoose.isValidObjectId(circleId)) throw httpError(400, "circle_id_invalid");

  const statusMatches = {
    upcoming: { status: "published", date: { $gte: new Date() } },
    cancelled: { status: "cancelled" },
  };

  const match = { status: { $in: ["published", "cancelled"] } };
  if (audience) match.audience = audience;
  if (circleId) match.circleId = new mongoose.Types.ObjectId(circleId);
  if (keyword !== undefined && String(keyword).trim()) {
    const expression = { $regex: escapeRegex(String(keyword).trim()), $options: "i" };
    const organizers = await User.find({ name: expression }).select("_id").limit(1000).lean();
    match.$or = [{ name: expression }, { creatorId: { $in: organizers.map((user) => user._id) } }];
  }

  const memberCircleIds = req.user?._id ? await circleIdsFor(req.user._id) : [];
  const visibility = isAdminUser(req.user)
    ? { "circle.deletedAt": null }
    : {
        "circle.deletedAt": null,
        $or: [
          { audience: "public", "circle.privacy": { $in: ["open", "approval"] } },
          ...(memberCircleIds.length ? [{ circleId: { $in: memberCircleIds } }] : []),
        ],
      };
  const countStatus = (name) => [{ $match: statusMatches[name] }, { $count: "count" }];

  const [result] = await Event.aggregate([
    { $match: match },
    {
      $lookup: {
        from: Circle.collection.name,
        let: { circleId: "$circleId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$circleId"] } } },
          { $project: { name: 1, privacy: 1, deletedAt: 1 } },
        ],
        as: "circle",
      },
    },
    { $set: { circle: { $first: "$circle" } } },
    { $match: visibility },
    {
      $facet: {
        items: [
          ...(status ? [{ $match: statusMatches[status] }] : []),
          { $sort: { date: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        totalRecords: [...(status ? [{ $match: statusMatches[status] }] : []), { $count: "count" }],
        total: [{ $count: "count" }],
        upcoming: countStatus("upcoming"),
        ongoing: [
          {
            $group: {
              _id: null,
              count: {
                $sum: {
                  $size: {
                    $filter: {
                      input: { $ifNull: ["$rsvps", []] },
                      as: "rsvp",
                      cond: { $eq: ["$$rsvp.status", "going"] },
                    },
                  },
                },
              },
            },
          },
        ],
        cancelled: countStatus("cancelled"),
        reports: [
          {
            $lookup: {
              from: UserReport.collection.name,
              let: { eventId: "$_id" },
              pipeline: [
                { $match: { resourceType: "event", $expr: { $eq: ["$resourceId", "$$eventId"] } } },
                { $count: "count" },
              ],
              as: "_reports",
            },
          },
          { $group: { _id: null, count: { $sum: { $ifNull: [{ $first: "$_reports.count" }, 0] } } } },
        ],
      },
    },
  ]);

  const items = result?.items || [];
  const organizerIdsOnPage = [...new Set(items.map((item) => String(item.creatorId)))];
  const organizers = organizerIdsOnPage.length
    ? await User.find({ _id: { $in: organizerIdsOnPage } })
        .select("name handle profileIcon")
        .lean()
    : [];
  const organizerById = new Map(organizers.map((user) => [String(user._id), user]));
  const data = items.map((item) => {
    const organizer = organizerById.get(String(item.creatorId));
    return {
      ...eventView(item, { viewerId: req.user?._id }),
      circleName: item.circle?.name || "",
      organizer: organizer
        ? {
            _id: idStr(organizer._id),
            name: organizer.name || "",
            handle: organizer.handle || "",
            profileIcon: organizer.profileIcon ? getFullImageUrl(organizer.profileIcon) : "",
          }
        : null,
    };
  });
  const countOf = (key) => result?.[key]?.[0]?.count || 0;
  const meta = generateMeta(page, limit, countOf("totalRecords"));
  meta.count = {
    total: countOf("total"),
    upcoming: countOf("upcoming"),
    ongoing: countOf("ongoing"),
    cancelled: countOf("cancelled"),
    reports: countOf("reports"),
  };
  return { data, meta };
}

async function listMyDraftEvents(userId) {
  const events = await Event.find({ creatorId: userId, status: "draft" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(2)
    .lean();
  return events.map((e) => eventView(e, { viewerId: userId }));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  createEvent,
  suggestEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
  rsvp,
  decideRsvp,
  cancelRsvp,
  listRsvps,
  getEvent,
  listEvents,
  listAllEvents,
  listMyDraftEvents,
  listMyActiveEvents,
  deleteEvent,
};
