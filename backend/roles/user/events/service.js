const mongoose = require("mongoose");
const Circle = require("@models/Circle");
const Event = require("@models/Event");
const { Drop } = require("@models/Drop");
const { User } = require("@UsersModel");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { httpError, idStr } = require("../_shared/serialize");
const { withTransaction } = require("../_shared/tradeShared");

function objectId(id, key = "event_not_found") {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, key);
  return new mongoose.Types.ObjectId(id);
}

function activeMember(circle, userId) {
  return (circle.members || []).find(
    (member) => String(member.userId) === String(userId) && member.status === "active",
  );
}

async function loadCircle(circleId, session = null) {
  const query = Circle.findOne({ _id: objectId(circleId, "circle_not_found"), deletedAt: null });
  if (session) query.session(session);
  const circle = await query;
  if (!circle) throw httpError(404, "circle_not_found");
  return circle;
}

function requireOrganizer(circle, userId) {
  const member = activeMember(circle, userId);
  if (!member || member.role !== "organizer") throw httpError(403, "circle_organizer_required");
}

function requireEventAccess(event, circle, userId) {
  if (event.audience === "member_only" && !activeMember(circle, userId)) {
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

async function createEvent(userId, body = {}) {
  const circle = await loadCircle(body.circleId);
  requireOrganizer(circle, userId);
  const fields = validateEventData(body);
  const [event] = await Event.create([
    { ...fields, circleId: circle._id, creatorId: userId, status: "draft" },
  ]);
  return eventView(event);
}

async function suggestEvent(userId, circleId, body = {}) {
  const circle = await loadCircle(circleId);
  if (!activeMember(circle, userId)) throw httpError(403, "circle_membership_required");
  const fields = validateEventData(body);
  if (!fields.name) throw httpError(400, "event_name_required");
  const [event] = await Event.create([
    {
      ...fields,
      circleId: circle._id,
      creatorId: userId,
      suggestedBy: userId,
      suggestionStatus: "pending",
      status: "draft",
    },
  ]);
  const organizers = circle.members
    .filter((member) => member.status === "active" && member.role === "organizer")
    .map((member) => String(member.userId))
    .filter((id) => id !== String(userId));
  if (organizers.length) {
    sendUserNotifications({
      recipientIds: organizers,
      sender: userId,
      title: "Event suggestion",
      body: "A Circle member suggested an Event.",
      data: { type: "event", objectType: "event" },
      objectId: event._id,
    });
  }
  return eventView(event);
}

function eventView(event, { viewerId = null, attendeeDetails = false } = {}) {
  const data = {
    _id: idStr(event._id),
    circleId: idStr(event.circleId),
    creatorId: idStr(event.creatorId),
    suggestedBy: event.suggestedBy ? idStr(event.suggestedBy) : null,
    approvedBy: event.approvedBy ? idStr(event.approvedBy) : null,
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
    suggestionStatus: event.suggestionStatus || null,
    rsvpCount: (event.rsvps || []).filter((rsvp) => rsvp.status === "going").length,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
  const ownRsvp = (event.rsvps || []).find((rsvp) => String(rsvp.userId) === String(viewerId));
  data.myRsvp = ownRsvp ? { status: ownRsvp.status, showToParticipants: ownRsvp.showToParticipants } : null;
  if (attendeeDetails) {
    data.attendees = (event.rsvps || [])
      .filter((rsvp) => rsvp.status === "going" && rsvp.showToParticipants)
      .map((rsvp) => ({ userId: idStr(rsvp.userId), showToParticipants: true }));
  }
  return data;
}

async function updateEvent(userId, eventId, body = {}) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  requireOrganizer(circle, userId);
  if (event.status === "cancelled") throw httpError(409, "invalid_status_transition");
  const fields = validateEventData(body);
  if (
    fields.capacity != null &&
    event.rsvps.filter((rsvp) => rsvp.status === "going").length > fields.capacity
  ) {
    throw httpError(409, "event_capacity_below_rsvp_count");
  }
  Object.assign(event, fields);
  await event.save();
  return eventView(event);
}

async function publishEvent(userId, eventId) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  requireOrganizer(circle, userId);
  if (event.suggestionStatus === "pending") throw httpError(409, "event_suggestion_requires_approval");
  if (event.status === "cancelled") throw httpError(409, "invalid_status_transition");
  validateEventData(event.toObject(), { publishing: true });
  event.status = "published";
  event.publishedAt = new Date();
  await event.save();
  const memberIds = circle.members
    .filter((member) => member.status === "active")
    .map((member) => String(member.userId))
    .filter((id) => id !== String(userId));
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
  return eventView(event);
}

async function cancelEvent(userId, eventId) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  requireOrganizer(circle, userId);
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

async function reviewSuggestion(userId, eventId, approve) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  requireOrganizer(circle, userId);
  if (event.suggestionStatus !== "pending") throw httpError(409, "invalid_status_transition");
  event.suggestionStatus = approve ? "approved" : "declined";
  event.approvedBy = userId;
  if (!approve) event.status = "cancelled";
  await event.save();
  if (event.suggestedBy) {
    sendUserNotifications({
      recipientIds: [String(event.suggestedBy)],
      sender: userId,
      title: approve ? "Event suggestion approved" : "Event suggestion declined",
      body: approve ? "Your Event suggestion was approved." : "Your Event suggestion was declined.",
      data: { type: "event", objectType: "event" },
      objectId: event._id,
    });
  }
  return eventView(event);
}

async function listSuggestions(userId, circleId, req) {
  const { page, limit } = parsePaginationParams(req);
  const circle = await loadCircle(circleId);
  requireOrganizer(circle, userId);
  const query = { circleId: circle._id, suggestionStatus: "pending" };
  const [items, total] = await Promise.all([
    Event.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Event.countDocuments(query),
  ]);
  return { data: items.map((item) => eventView(item)), meta: generateMeta(page, limit, total) };
}

async function removeSuggestion(userId, eventId) {
  const event = await Event.findById(objectId(eventId));
  if (!event) throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  requireOrganizer(circle, userId);
  if (event.suggestionStatus !== "pending") throw httpError(409, "invalid_status_transition");
  event.suggestionStatus = "declined";
  event.status = "cancelled";
  event.cancelledAt = new Date();
  await event.save();
  return { deleted: true };
}

async function rsvp(userId, eventId, showToParticipants = false) {
  const eventObjectId = objectId(eventId);
  const result = await withTransaction(async (session) => {
    const event = await Event.findById(eventObjectId).session(session);
    if (!event || event.status !== "published") throw httpError(404, "event_not_found");
    const circle = await loadCircle(event.circleId, session);
    requireEventAccess(event, circle, userId);
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
      organizerIds: circle.members
        .filter((member) => member.status === "active" && member.role === "organizer")
        .map((member) => String(member.userId))
        .filter((id) => id !== String(userId)),
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
    requireOrganizer(circle, userId);
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
    requireEventAccess(event, circle, userId);
    const rsvp = event.rsvps.find((entry) => String(entry.userId) === String(userId));
    if (!rsvp || rsvp.status === "cancelled") throw httpError(404, "event_rsvp_not_found");
    rsvp.status = "cancelled";
    rsvp.respondedAt = new Date();
    await event.save({ session });
    return { event, organizerIds: circle.members
      .filter((member) => member.role === "organizer" && member.status === "active")
      .map((member) => String(member.userId)) };
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

async function getEvent(eventId, userId = null) {
  const event = await Event.findById(objectId(eventId)).lean();
  if (!event || event.status !== "published") throw httpError(404, "event_not_found");
  const circle = await loadCircle(event.circleId);
  requireEventAccess(event, circle, userId);
  const memberIds = circle.members.filter((member) => member.status === "active").map((member) => member.userId);
  const drops = await Drop.find({
    ownerId: { $in: memberIds },
    status: "open",
    deletedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  })
    .select("_id ownerId concept date")
    .sort({ createdAt: -1 })
    .lean();
  const view = eventView(event, {
    viewerId: userId,
    attendeeDetails: Boolean(
      userId &&
        (activeMember(circle, userId) ||
          event.rsvps.some((rsvp) => String(rsvp.userId) === String(userId) && rsvp.status === "going")),
    ),
  });
  if (view.attendees) {
    const attendeeIds = view.attendees.map((attendee) => attendee.userId);
    const attendees = await User.find({ _id: { $in: attendeeIds } }).select("name handle profileIcon").lean();
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
    title: drop.concept || "",
    date: drop.date || null,
  }));
  return view;
}

async function listEvents(req, { excludeUserIds = [] } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const { lat, lng, radius, anywhere, keyword } = req.query;
  const match = { status: "published", date: { $gte: new Date() } };
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
      Number(lat) < -90 || Number(lat) > 90 || Number(lng) < -180 || Number(lng) > 180)
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
        ...(req.user?._id
          ? {
              $or: [
                { audience: "public", "circle.privacy": { $in: ["open", "approval"] } },
                {
                  "circle.members": {
                    $elemMatch: {
                      userId: new mongoose.Types.ObjectId(String(req.user._id)),
                      status: "active",
                    },
                  },
                },
              ],
            }
          : { audience: "public", "circle.privacy": { $in: ["open", "approval"] } }),
      },
    },
    { $facet: { items: [{ $sort: { date: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "count" }] } },
  ]);
  const data = (result?.items || []).map((item) => ({
    ...eventView(item, { viewerId: req.user?._id }),
    distanceMeters: item.distanceMeters ?? null,
  }));
  return { data, meta: generateMeta(page, limit, result?.total?.[0]?.count || 0) };
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
  reviewSuggestion,
  listSuggestions,
  removeSuggestion,
  rsvp,
  decideRsvp,
  cancelRsvp,
  getEvent,
  listEvents,
};
