const mongoose = require("mongoose");
const Circle = require("@models/Circle");
const Event = require("@models/Event");
const { Drop } = require("@models/Drop");
const { User } = require("@UsersModel");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const Conversation = require("@backend/commonModules/chatModule/models/Conversation");
const Message = require("@backend/commonModules/chatModule/models/Message");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { httpError, idStr } = require("../_shared/serialize");

const PRIVACY_MODES = ["open", "approval", "invite_only"];

function objectId(id, key = "circle_not_found") {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, key);
  return new mongoose.Types.ObjectId(id);
}

function memberFor(circle, userId) {
  return (circle.members || []).find(
    (member) => String(member.userId) === String(userId) && member.status === "active",
  );
}

function requireMember(circle, userId) {
  const member = memberFor(circle, userId);
  if (!member) throw httpError(403, "circle_membership_required");
  return member;
}

function requireOrganizer(circle, userId) {
  const member = requireMember(circle, userId);
  if (member.role !== "organizer") throw httpError(403, "circle_organizer_required");
  return member;
}

async function loadCircle(circleId, session = null) {
  const query = Circle.findOne({ _id: objectId(circleId), deletedAt: null });
  if (session) query.session(session);
  const circle = await query;
  if (!circle) throw httpError(404, "circle_not_found");
  return circle;
}

function circleView(circle, { includeMembers = false } = {}) {
  const members = circle.members || [];
  const active = members.filter((member) => member.status === "active");
  const pending = members.filter((member) => member.status === "pending");
  const invited = members.filter((member) => member.status === "invited");
  const result = {
    _id: idStr(circle._id),
    creatorId: idStr(circle.creatorId),
    name: circle.name,
    purpose: circle.purpose,
    category: idStr(circle.category),
    coverImage: circle.coverImage || "",
    city: circle.city || "",
    privacy: circle.privacy,
    location: circle.location || null,
    conversationId: circle.conversationId ? idStr(circle.conversationId) : null,
    memberCount: active.length,
    pendingRequestCount: pending.length,
    joinedInvitationCount: active.filter((member) => member.invitedBy).length,
    pendingInvitationCount: invited.length,
    poll: circle.poll
      ? {
          question: circle.poll.question,
          options: circle.poll.options,
          createdBy: idStr(circle.poll.createdBy),
          closesAt: circle.poll.closesAt,
          status: circle.poll.closesAt <= new Date() ? "closed" : circle.poll.status,
          voteCount: circle.poll.votes?.length || 0,
          voteCounts: circle.poll.options.map(
            (_, index) => circle.poll.votes.filter((vote) => vote.optionIndex === index).length,
          ),
        }
      : null,
    createdAt: circle.createdAt,
    updatedAt: circle.updatedAt,
  };
  if (includeMembers) {
    result.members = active.map((member) => ({
      userId: idStr(member.userId),
      role: member.role,
      joinedAt: member.joinedAt,
    }));
    result.pendingMembers = pending.map((member) => ({ userId: idStr(member.userId), status: member.status }));
    result.pendingInvitations = invited.map((member) => ({ userId: idStr(member.userId), status: member.status }));
  }
  return result;
}

async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function createCircle(userId, body = {}) {
  if (!body.name || !String(body.name).trim()) throw httpError(400, "circle_name_required");
  if (!body.purpose || !String(body.purpose).trim()) throw httpError(400, "circle_purpose_required");
  if (!mongoose.isValidObjectId(body.category)) throw httpError(400, "circle_category_required");
  const privacy = body.privacy || "open";
  if (!PRIVACY_MODES.includes(privacy)) throw httpError(400, "circle_privacy_invalid");
  if ((body.lng === undefined) !== (body.lat === undefined)) throw httpError(400, "circle_location_invalid");
  const coordinates =
    body.lng !== undefined && body.lat !== undefined ? [Number(body.lng), Number(body.lat)] : undefined;
  if (
    coordinates &&
    (String(body.lng).trim() === "" ||
      String(body.lat).trim() === "" ||
      !coordinates.every(Number.isFinite) ||
      coordinates[0] < -180 ||
      coordinates[0] > 180 ||
      coordinates[1] < -90 ||
      coordinates[1] > 90)
  ) {
    throw httpError(400, "circle_location_invalid");
  }

  return withTransaction(async (session) => {
    const [conversation] = await Conversation.create(
      [
        {
          type: "group",
          groupName: String(body.name).trim(),
          participants: [{ user: userId, role: "admin", isActive: true }],
          admins: [userId],
          groupSettings: { isPrivate: privacy === "invite_only", canMessage: true },
          unreadCounts: { [String(userId)]: 0 },
        },
      ],
      { session },
    );
    const [circle] = await Circle.create(
      [
        {
          creatorId: userId,
          name: String(body.name).trim(),
          purpose: String(body.purpose).trim(),
          category: body.category,
          coverImage: String(body.coverImage || "").trim(),
          city: String(body.city || "").trim(),
          privacy,
          ...(coordinates ? { location: { type: "Point", coordinates } } : {}),
          members: [{ userId, role: "organizer", status: "active", joinedAt: new Date() }],
          conversationId: conversation._id,
        },
      ],
      { session },
    );
    conversation.circleId = circle._id;
    await conversation.save({ session });
    return circleView(circle);
  });
}

async function listCircles(req, { excludeUserIds = [] } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, city, category, lat, lng, radius } = req.query;
  const match = { deletedAt: null, privacy: { $in: ["open", "approval"] } };
  if (excludeUserIds.length) match.creatorId = { $nin: excludeUserIds };
  if (city) match.city = { $regex: `^${escapeRegex(String(city).trim())}$`, $options: "i" };
  if (category) {
    if (!mongoose.isValidObjectId(category)) throw httpError(400, "circle_category_invalid");
    match.category = new mongoose.Types.ObjectId(category);
  }
  if (keyword?.trim()) {
    const expression = { $regex: escapeRegex(keyword.trim()), $options: "i" };
    match.$or = [{ name: expression }, { purpose: expression }, { city: expression }];
  }
  const hasGeo = lat !== undefined && lng !== undefined;
  if (
    (lat !== undefined || lng !== undefined) &&
    (lat === undefined ||
      lng === undefined ||
      String(lat).trim() === "" ||
      String(lng).trim() === "" ||
      !Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lng)) ||
      Number(lat) < -90 || Number(lat) > 90 || Number(lng) < -180 || Number(lng) > 180)
  ) {
    throw httpError(400, "circle_location_invalid");
  }
  if (radius !== undefined && (!Number.isFinite(Number(radius)) || Number(radius) <= 0)) {
    throw httpError(400, "circle_radius_invalid");
  }
  const pipeline = hasGeo
    ? [
        {
          $geoNear: {
            near: { type: "Point", coordinates: [Number(lng), Number(lat)] },
            key: "location",
            distanceField: "distanceMeters",
            maxDistance: (Number(radius) || 50) * 1000,
            spherical: true,
            query: match,
          },
        },
      ]
    : [{ $match: match }];
  const [result] = await Circle.aggregate([
    ...pipeline,
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);
  const data = (result?.items || []).map((circle) => ({
    ...circleView(circle),
    distanceMeters: circle.distanceMeters ?? null,
  }));
  return { data, meta: generateMeta(page, limit, result?.total?.[0]?.count || 0) };
}

async function listMyCircles(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const filter = { members: { $elemMatch: { userId, status: "active" } }, deletedAt: null };
  const keyword = String(req.query.keyword || "").trim();
  if (keyword) {
    const expression = { $regex: escapeRegex(keyword), $options: "i" };
    filter.$or = [{ name: expression }, { purpose: expression }, { city: expression }];
  }
  const [items, total] = await Promise.all([
    Circle.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Circle.countDocuments(filter),
  ]);
  return { data: items.map((item) => circleView(item)), meta: generateMeta(page, limit, total) };
}

async function getCircle(circleId, viewerId = null) {
  const circle = await loadCircle(circleId);
  const isMember = viewerId && memberFor(circle, viewerId);
  if (circle.privacy === "invite_only" && !isMember) throw httpError(404, "circle_not_found");
  const memberIds = (circle.members || [])
    .filter((member) => member.status === "active")
    .map((member) => member.userId);
  const [latestEvent, openDrops] = await Promise.all([
    Event.findOne({ circleId: circle._id, status: "published" }).sort({ date: -1, _id: -1 }).lean(),
    Drop.find({
      ownerId: { $in: memberIds },
      status: "open",
      deletedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ createdAt: -1 })
      .select("_id ownerId concept status date")
      .lean(),
  ]);
  const view = circleView(circle, { includeMembers: Boolean(isMember) });
  view.latestEvent = latestEvent
    ? { _id: idStr(latestEvent._id), name: latestEvent.name, date: latestEvent.date, status: latestEvent.status }
    : null;
  view.openDrops = openDrops.map((drop) => ({
    _id: idStr(drop._id),
    ownerId: idStr(drop.ownerId),
    title: drop.concept || "",
    status: drop.status,
    date: drop.date || null,
  }));
  return view;
}

async function updateCircle(userId, circleId, body = {}) {
  const set = {};
  for (const field of ["name", "purpose", "coverImage", "city"]) {
    if (body[field] !== undefined) set[field] = String(body[field]).trim();
  }
  if (body.category !== undefined) {
    if (!mongoose.isValidObjectId(body.category)) throw httpError(400, "circle_category_invalid");
    set.category = body.category;
  }
  if (body.privacy !== undefined) {
    if (!PRIVACY_MODES.includes(body.privacy)) throw httpError(400, "circle_privacy_invalid");
    set.privacy = body.privacy;
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
      throw httpError(400, "circle_location_invalid");
    }
    set.location = { type: "Point", coordinates: [Number(body.lng), Number(body.lat)] };
  }
  return withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    requireOrganizer(circle, userId);
    const updated = await Circle.findByIdAndUpdate(
      circle._id,
      { $set: set },
      { new: true, runValidators: true, session },
    );
    if (body.name !== undefined || body.privacy !== undefined) {
      const conversationSet = {};
      if (body.name !== undefined) conversationSet.groupName = set.name;
      if (body.privacy !== undefined) conversationSet["groupSettings.isPrivate"] = body.privacy === "invite_only";
      await Conversation.updateOne({ _id: circle.conversationId }, { $set: conversationSet }, { session });
    }
    return circleView(updated);
  });
}

async function joinCircle(userId, circleId) {
  const result = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    if (memberFor(circle, userId)) throw httpError(409, "circle_already_joined");
    const status = circle.privacy === "open" ? "active" : circle.privacy === "approval" ? "pending" : null;
    if (!status) throw httpError(403, "circle_invitation_required");
    const existing = (circle.members || []).find((member) => String(member.userId) === String(userId));
    const updated = existing
      ? await Circle.findOneAndUpdate(
          {
            _id: circle._id,
            deletedAt: null,
            members: { $elemMatch: { userId, status: { $in: ["left", "declined"] } } },
          },
          {
            $set: {
              "members.$.role": "member",
              "members.$.status": status,
              "members.$.joinedAt": status === "active" ? new Date() : null,
              "members.$.updatedAt": new Date(),
            },
          },
          { new: true, session },
        )
      : await Circle.findOneAndUpdate(
          { _id: circle._id, deletedAt: null, "members.userId": { $ne: userId } },
          {
            $push: {
              members: { userId, role: "member", status, joinedAt: status === "active" ? new Date() : null },
            },
          },
          { new: true, session },
        );
    if (!updated) throw httpError(409, "circle_membership_exists");
    if (status === "active") await addChatMember(updated, userId, session);
    return { status, circle, updated };
  });
  const { status, circle, updated } = result;
  if (status === "pending") {
    const organizerIds = circle.members
      .filter((member) => member.status === "active" && member.role === "organizer")
      .map((member) => String(member.userId));
    if (organizerIds.length) {
      sendUserNotifications({
        recipientIds: organizerIds,
        sender: userId,
        title: "Circle membership request",
        body: `${circle.name} has a new membership request.`,
        data: { type: "circle_request", objectType: "circle" },
        objectId: circle._id,
      });
    }
  }
  return { status, circle: circleView(updated) };
}

async function addChatMember(circle, userId, session = null) {
  const options = session ? { session } : {};
  const reactivated = await Conversation.updateOne(
    { _id: circle.conversationId, participants: { $elemMatch: { user: userId, isActive: false } } },
    {
      $set: {
        "participants.$.isActive": true,
        "participants.$.removedAt": null,
        [`unreadCounts.${String(userId)}`]: 0,
      },
    },
    options,
  );
  if (reactivated.matchedCount) return;
  await Conversation.updateOne(
    { _id: circle.conversationId, "participants.user": { $ne: userId } },
    {
      $push: { participants: { user: userId, role: "member", isActive: true } },
      $set: { [`unreadCounts.${String(userId)}`]: 0 },
    },
    options,
  );
}

async function decideMembership(userId, circleId, targetUserId, approve) {
  const updated = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    requireOrganizer(circle, userId);
    const status = approve ? "active" : "declined";
    const updatedCircle = await Circle.findOneAndUpdate(
      { _id: circle._id, members: { $elemMatch: { userId: targetUserId, status: "pending" } } },
      { $set: { "members.$.status": status, "members.$.joinedAt": approve ? new Date() : null, "members.$.updatedAt": new Date() } },
      { new: true, session },
    );
    if (!updatedCircle) throw httpError(404, "circle_request_not_found");
    if (approve) await addChatMember(updatedCircle, targetUserId, session);
    return { circleId: circle._id, updatedCircle };
  });
  const { circleId: updatedCircleId, updatedCircle } = updated;
  sendUserNotifications({
    recipientIds: [String(targetUserId)],
    sender: userId,
    title: approve ? "Circle request approved" : "Circle request declined",
    body: approve ? "Your Circle membership request was approved." : "Your Circle membership request was declined.",
    data: { type: "circle_status", objectType: "circle" },
    objectId: updatedCircleId,
  });
  return circleView(updatedCircle);
}

async function inviteUsers(userId, circleId, userIds = []) {
  if (!Array.isArray(userIds) || !userIds.length || userIds.length > 50) throw httpError(400, "circle_invite_list_invalid");
  const circle = await loadCircle(circleId);
  requireOrganizer(circle, userId);
  if (circle.privacy !== "invite_only") throw httpError(409, "circle_not_invite_only");
  const ids = [...new Set(userIds.map((id) => String(objectId(id, "user_not_found"))))];
  const users = await User.find({ _id: { $in: ids }, deletedAt: null }).select("_id").lean();
  if (users.length !== ids.length) throw httpError(404, "user_not_found");
  const previouslyInvited = new Set(
    (circle.members || [])
      .filter((member) => ["active", "pending", "invited"].includes(member.status))
      .map((member) => String(member.userId)),
  );
  const newlyInvited = ids.filter((id) => !previouslyInvited.has(id));
  const operations = ids.map((id) => {
    const current = circle.members.find((member) => String(member.userId) === id);
    const filter = current
      ? { _id: circle._id, members: { $elemMatch: { userId: id, status: { $in: ["left", "declined"] } } } }
      : { _id: circle._id, "members.userId": { $ne: id } };
    const update = current
      ? {
          $set: {
            "members.$.role": "member",
            "members.$.status": "invited",
            "members.$.invitedBy": userId,
            "members.$.updatedAt": new Date(),
          },
        }
      : { $push: { members: { userId: id, role: "member", status: "invited", invitedBy: userId } } };
    return { updateOne: { filter, update } };
  });
  if (operations.length) await Circle.bulkWrite(operations);
  const updated = await loadCircle(circleId);
  if (newlyInvited.length) {
    sendUserNotifications({
      recipientIds: newlyInvited,
      sender: userId,
      title: "Circle invitation",
      body: `You were invited to join ${circle.name}.`,
      data: { type: "circle_invitation", objectType: "circle" },
      objectId: circle._id,
    });
  }
  return circleView(updated, { includeMembers: true });
}

async function respondInvitation(userId, circleId, accept) {
  const result = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    const status = accept ? "active" : "declined";
    const updated = await Circle.findOneAndUpdate(
      { _id: circle._id, members: { $elemMatch: { userId, status: "invited" } } },
      { $set: { "members.$.status": status, "members.$.joinedAt": accept ? new Date() : null, "members.$.updatedAt": new Date() } },
      { new: true, session },
    );
    if (!updated) throw httpError(404, "circle_invitation_not_found");
    if (accept) await addChatMember(updated, userId, session);
    return { circle, updated };
  });
  const { circle, updated } = result;
  const organizers = circle.members
    .filter((member) => member.status === "active" && member.role === "organizer")
    .map((member) => String(member.userId))
    .filter((id) => id !== String(userId));
  if (organizers.length) {
    sendUserNotifications({
      recipientIds: organizers,
      sender: userId,
      title: accept ? "Circle invitation accepted" : "Circle invitation declined",
      body: accept ? "A user accepted the Circle invitation." : "A user declined the Circle invitation.",
      data: { type: "circle_status", objectType: "circle" },
      objectId: circle._id,
    });
  }
  return circleView(updated);
}

async function leaveCircle(userId, circleId) {
  await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    const member = requireMember(circle, userId);
    if (String(circle.creatorId) === String(userId) || member.role === "organizer") {
      throw httpError(409, "transfer_organizer_or_delete_circle");
    }
    await Circle.updateOne(
      { _id: circle._id, "members.userId": userId, "members.status": "active" },
      { $set: { "members.$.status": "left", "members.$.updatedAt": new Date() } },
      { session },
    );
    await Conversation.updateOne(
      { _id: circle.conversationId, "participants.user": userId },
      { $set: { "participants.$.isActive": false, "participants.$.removedAt": new Date() } },
      { session },
    );
  });
  return { left: true };
}

async function transferOrganizer(userId, circleId, targetUserId) {
  if (String(userId) === String(targetUserId)) throw httpError(400, "cannot_transfer_to_self");
  const circle = await loadCircle(circleId);
  requireOrganizer(circle, userId);
  if (!memberFor(circle, targetUserId)) throw httpError(400, "target_must_be_circle_member");
  return withTransaction(async (session) => {
    await Circle.updateOne(
      { _id: circle._id, "members.userId": userId, "members.status": "active" },
      { $set: { "members.$.role": "member" } },
      { session },
    );
    const updated = await Circle.findOneAndUpdate(
      { _id: circle._id, "members.userId": targetUserId, "members.status": "active" },
      {
        $set: {
          ...(String(circle.creatorId) === String(userId) ? { creatorId: targetUserId } : {}),
          "members.$.role": "organizer",
        },
      },
      { new: true, session },
    );
    await Conversation.updateOne(
      { _id: circle.conversationId },
      { $addToSet: { admins: targetUserId }, $pull: { admins: userId } },
      { session },
    );
    return circleView(updated, { includeMembers: true });
  });
}

async function deleteCircle(userId, circleId) {
  const circle = await loadCircle(circleId);
  if (String(circle.creatorId) !== String(userId)) throw httpError(403, "circle_creator_required");
  return withTransaction(async (session) => {
    const now = new Date();
    await Circle.updateOne({ _id: circle._id, deletedAt: null }, { $set: { deletedAt: now } }, { session });
    await Event.updateMany({ circleId: circle._id, status: { $ne: "cancelled" } }, { $set: { status: "cancelled", cancelledAt: now } }, { session });
    const conversation = await Conversation.findById(circle.conversationId).session(session).lean();
    if (conversation) {
      await Message.updateMany({ conversationId: conversation._id }, { $set: { isDeleted: true } }, { session });
      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { isDeleted: true, "participants.$[].isActive": false } },
        { session },
      );
    }
    return { deleted: true };
  });
}

async function createPoll(userId, circleId, body = {}) {
  if (!String(body.question || "").trim() || !Array.isArray(body.options)) throw httpError(400, "circle_poll_invalid");
  const options = body.options.map((option) => String(option).trim());
  if (
    options.length < 2 ||
    options.length > 8 ||
    options.some((option) => !option || option.length > 120) ||
    new Set(options.map((option) => option.toLowerCase())).size !== options.length
  ) {
    throw httpError(400, "circle_poll_invalid");
  }
  const closesAt = new Date(body.closesAt);
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) throw httpError(400, "poll_close_date_invalid");
  const circle = await loadCircle(circleId);
  requireOrganizer(circle, userId);
  const now = new Date();
  const updated = await Circle.findOneAndUpdate(
    {
      _id: circle._id,
      deletedAt: null,
      $or: [
        { poll: null },
        { "poll.status": "closed" },
        { "poll.status": "active", "poll.closesAt": { $lte: now } },
      ],
    },
    { $set: { poll: { question: String(body.question).trim(), options, createdBy: userId, closesAt, status: "active", votes: [] } } },
    { new: true, runValidators: true },
  );
  if (!updated) throw httpError(409, "active_poll_exists");
  return {
    question: updated.poll.question,
    options: updated.poll.options,
    closesAt: updated.poll.closesAt,
    status: updated.poll.status,
    voteCount: updated.poll.votes.length,
    voteCounts: updated.poll.options.map(
      (_, voteIndex) => updated.poll.votes.filter((vote) => vote.optionIndex === voteIndex).length,
    ),
  };
}

async function votePoll(userId, circleId, optionIndex) {
  if (!Number.isInteger(Number(optionIndex))) throw httpError(400, "poll_option_invalid");
  const circle = await loadCircle(circleId);
  requireMember(circle, userId);
  const poll = circle.poll;
  if (!poll || poll.status !== "active" || poll.closesAt <= new Date()) throw httpError(409, "poll_closed");
  const index = Number(optionIndex);
  if (index < 0 || index >= poll.options.length) throw httpError(400, "poll_option_invalid");
  const updated = await Circle.findOneAndUpdate(
    {
      _id: circle._id,
      "poll.status": "active",
      "poll.closesAt": { $gt: new Date() },
      "poll.options": poll.options,
      "poll.votes.userId": { $ne: userId },
    },
    { $push: { "poll.votes": { userId, optionIndex: index, votedAt: new Date() } } },
    { new: true, runValidators: true },
  );
  if (!updated) throw httpError(409, "poll_vote_duplicate_or_closed");
  return {
    question: updated.poll.question,
    options: updated.poll.options,
    closesAt: updated.poll.closesAt,
    status: updated.poll.closesAt <= new Date() ? "closed" : updated.poll.status,
    voteCount: updated.poll.votes.length,
    voteCounts: updated.poll.options.map(
      (_, voteIndex) => updated.poll.votes.filter((vote) => vote.optionIndex === voteIndex).length,
    ),
    myVote: index,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  createCircle,
  listCircles,
  listMyCircles,
  getCircle,
  updateCircle,
  joinCircle,
  decideMembership,
  inviteUsers,
  respondInvitation,
  leaveCircle,
  transferOrganizer,
  deleteCircle,
  createPoll,
  votePoll,
};
