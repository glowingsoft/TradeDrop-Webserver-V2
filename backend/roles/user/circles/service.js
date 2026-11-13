const mongoose = require("mongoose");
const Circle = require("@models/Circle");
const Category = require("@models/Category");
const UserReport = require("@models/UserReport");
const Event = require("@models/Event");
const Connection = require("@models/Connection");
const { getConnectionStatuses } = require("@helperUtils/connectionUtil");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const CircleMember = require("@models/CircleMember");
const CirclePollVote = require("@models/CirclePollVote");
const membership = require("./membership");
const { Drop } = require("@models/Drop");
const { User } = require("@UsersModel");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const Conversation = require("@backend/commonModules/chatModule/models/Conversation");
const Message = require("@backend/commonModules/chatModule/models/Message");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { httpError, idStr, isAdminUser } = require("../_shared/serialize");

const PRIVACY_MODES = ["open", "approval", "invite_only"];
const MAX_ACTIVE_POLLS = 1;
const DEFAULT_POLL_DURATION_MS = 2 * 24 * 60 * 60 * 1000;

const MEMBER_PREVIEW_LIMIT = 50;
const LATEST_MEMBERS_LIMIT = 3;
const LATEST_POLLS_LIMIT = 2;
const EMPTY_COUNTS = { memberCount: 0, pendingRequestCount: 0, pendingInvitationCount: 0, joinedInvitationCount: 0 };

function objectId(id, key = "circle_not_found") {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, key);
  return new mongoose.Types.ObjectId(id);
}

async function requireMember(circle, userId, session = null) {
  const member = await membership.getMember(circle._id, userId, { session });
  if (!member) throw httpError(403, "circle_membership_required");
  return member;
}

async function requireOrganizer(circle, userId, session = null) {
  const member = await requireMember(circle, userId, session);
  if (member.role !== "organizer") throw httpError(403, "circle_organizer_required");
  return member;
}

async function pollVoteSummaries(circles, viewerId = null) {
  const summaries = new Map();
  const circleIds = [];
  for (const circle of circles) {
    if (!circle.polls?.length) continue;
    circleIds.push(circle._id);
    for (const poll of circle.polls) {
      summaries.set(`${circle._id}:${poll._id}`, {
        voteCount: 0,
        voteCounts: poll.options.map(() => 0),
        myVote: null,
      });
    }
  }
  if (!circleIds.length) return summaries;
  const viewerObjectId = viewerId && mongoose.isValidObjectId(viewerId) ? new mongoose.Types.ObjectId(viewerId) : null;
  const rows = await CirclePollVote.aggregate([
    { $match: { circleId: { $in: circleIds } } },
    {
      $group: {
        _id: { circleId: "$circleId", pollId: "$pollId", optionIndex: "$optionIndex" },
        count: { $sum: 1 },
        viewerVotes: { $sum: { $cond: [{ $eq: ["$userId", viewerObjectId] }, 1, 0] } },
      },
    },
  ]);
  for (const row of rows) {
    const summary = summaries.get(`${row._id.circleId}:${row._id.pollId}`);
    if (!summary) continue;
    summary.voteCount += row.count;
    if (row._id.optionIndex >= 0 && row._id.optionIndex < summary.voteCounts.length) {
      summary.voteCounts[row._id.optionIndex] += row.count;
    }
    if (row.viewerVotes) summary.myVote = row._id.optionIndex;
  }
  return summaries;
}

function pollView(poll, summary, now = new Date()) {
  const status = poll.closesAt <= now ? "closed" : poll.status;
  return {
    _id: idStr(poll._id),
    question: poll.question,
    options: poll.options,
    createdBy: idStr(poll.createdBy),
    closesAt: poll.closesAt,
    status,
    voteCount: summary?.voteCount || 0,
    voteCounts: summary?.voteCounts || poll.options.map(() => 0),
  };
}

function pollViewForViewer(poll, summary, now) {
  return {
    ...pollView(poll, summary, now),
    myVote: summary?.myVote ?? null,
  };
}

async function loadCircle(circleId, session = null) {
  const query = Circle.findOne({ _id: objectId(circleId), deletedAt: null });
  if (session) query.session(session);
  const circle = await query;
  if (!circle) throw httpError(404, "circle_not_found");
  return circle;
}

function circleView(circle, counts = EMPTY_COUNTS, voteSummaries = new Map()) {
  const polls = (circle.polls || []).map((poll) => pollView(poll, voteSummaries.get(`${circle._id}:${poll._id}`)));
  return {
    _id: idStr(circle._id),
    creatorId: idStr(circle.creatorId),
    name: circle.name,
    purpose: circle.purpose,
    category:
      circle.category && typeof circle.category === "object" && circle.category._id
        ? { _id: idStr(circle.category._id), name: circle.category.name || "" }
        : idStr(circle.category),
    coverImage: circle.coverImage || "",
    city: circle.city || "",
    privacy: circle.privacy,
    status: circle.status || "active",
    location: circle.location || null,
    conversationId: circle.conversationId ? idStr(circle.conversationId) : null,
    memberCount: counts.memberCount,
    pendingRequestCount: counts.pendingRequestCount,
    joinedInvitationCount: counts.joinedInvitationCount,
    pendingInvitationCount: counts.pendingInvitationCount,
    polls,
    poll: polls[polls.length - 1] || null,
    createdAt: circle.createdAt,
    updatedAt: circle.updatedAt,
  };
}

function memberCountExpression(status, field = "count") {
  return {
    $ifNull: [
      {
        $arrayElemAt: [
          {
            $map: {
              input: {
                $filter: {
                  input: "$_memberCounts",
                  as: "entry",
                  cond: { $eq: ["$$entry._id", status] },
                },
              },
              as: "entry",
              in: `$$entry.${field}`,
            },
          },
          0,
        ],
      },
      0,
    ],
  };
}

async function presentCircles(circles, voteSummaries = null) {
  if (!circles.length) return [];
  const [counts, summaries] = await Promise.all([
    membership.countsFor(circles.map((circle) => circle._id)),
    voteSummaries || pollVoteSummaries(circles),
  ]);
  return circles.map((circle) => circleView(circle, counts.get(String(circle._id)) || EMPTY_COUNTS, summaries));
}

async function presentCircle(circle, { includeMembers = false, voteSummaries = null } = {}) {
  const [view] = await presentCircles([circle], voteSummaries);
  if (!includeMembers) return view;
  const [pending, invited] = await Promise.all(
    ["pending", "invited"].map((status) =>
      CircleMember.find({ circleId: circle._id, status })
        .sort({ joinedAt: 1, _id: 1 })
        .limit(MEMBER_PREVIEW_LIMIT)
        .lean(),
    ),
  );
  view.pendingMembers = pending.map((member) => ({ userId: idStr(member.userId), status: member.status }));
  view.pendingInvitations = invited.map((member) => ({ userId: idStr(member.userId), status: member.status }));
  return view;
}

async function listMembers(userId, circleId, req) {
  const circle = await loadCircle(circleId);
  const status = req.query.status || "active";
  if (!["active", "pending", "invited"].includes(status)) throw httpError(400, "circle_member_status_invalid");
  if (status === "active" && !isAdminUser(req.user)) await requireMember(circle, userId);
  else if (status !== "active" && !isAdminUser(req.user)) await requireOrganizer(circle, userId);
  const { page, limit } = parsePaginationParams(req);
  const filter = { circleId: circle._id, status };
  const [items, total] = await Promise.all([
    CircleMember.find(filter)
      .populate("userId", { name: 1, handle: 1, profileIcon: 1 })
      .sort({ joinedAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CircleMember.countDocuments(filter),
  ]);
  return {
    data: items.map((member) => ({
      user: {
        _id: idStr(member.userId?._id),
        name: member.userId?.name || "",
        handle: member.userId?.handle || "",
        profileIcon: member.userId?.profileIcon ? getFullImageUrl(member.userId.profileIcon) : "",
      },
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
    })),
    meta: generateMeta(page, limit, total),
  };
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

  const inviteeIds = await resolveInvitees(userId, body.memberIds ?? body.userIds ?? []);

  const created = await withTransaction(async (session) => {
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
          conversationId: conversation._id,
        },
      ],
      { session },
    );
    await CircleMember.insertMany(
      [
        { circleId: circle._id, userId, role: "organizer", status: "active", joinedAt: new Date() },
        ...inviteeIds.map((id) => ({
          circleId: circle._id,
          userId: id,
          role: "member",
          status: "invited",
          invitedBy: userId,
        })),
      ],
      { session },
    );
    conversation.circleId = circle._id;
    await conversation.save({ session });
    return circle;
  });
  const view = await presentCircle(created);
  if (inviteeIds.length) {
    sendUserNotifications({
      recipientIds: inviteeIds,
      sender: userId,
      title: "Circle invitation",
      body: `You were invited to join ${created.name}.`,
      data: { type: "circle_invitation", objectType: "circle" },
      objectId: created._id,
    });
  }
  return view;
}

async function resolveInvitees(organizerId, userIds) {
  if (!Array.isArray(userIds) || userIds.length > 50) throw httpError(400, "circle_invite_list_invalid");
  const ids = [...new Set(userIds.map((id) => String(objectId(id, "user_not_found"))))].filter(
    (id) => id !== String(organizerId),
  );
  if (!ids.length) return ids;
  const users = await User.find({ _id: { $in: ids }, deletedAt: null })
    .select("_id")
    .lean();
  if (users.length !== ids.length) throw httpError(404, "user_not_found");
  const connections = await Connection.find({
    status: "active",
    $or: [
      { userA: organizerId, userB: { $in: ids } },
      { userB: organizerId, userA: { $in: ids } },
    ],
  })
    .select("userA userB")
    .lean();
  const connected = new Set(
    connections.map((item) => (String(item.userA) === String(organizerId) ? String(item.userB) : String(item.userA))),
  );
  if (ids.some((id) => !connected.has(id))) throw httpError(403, "circle_invitee_not_connected");
  return ids;
}

async function listAllCircles(req, { excludeUserIds = [] } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, city, category, privacy, status } = req.query;
  const match = { deletedAt: null };
  const privacyValues = {
    open: "open",
    "invite-only": "invite_only",
    invite_only: "invite_only",
    "approval-required": "approval",
    approval: "approval",
  };
  const isAdmin = isAdminUser(req.user);
  if (privacy !== undefined) {
    const requestedPrivacy = String(privacy).trim();
    if (!Object.prototype.hasOwnProperty.call(privacyValues, requestedPrivacy)) {
      throw httpError(400, "circle_privacy_invalid");
    }
    const storedPrivacy = privacyValues[requestedPrivacy];
    match.privacy = storedPrivacy;
    if (storedPrivacy === "invite_only" && !isAdmin) {
      match._id = { $in: await membership.circleIdsFor(req.user?._id) };
    }
  } else if (!isAdmin) {
    match.privacy = { $in: ["open", "approval"] };
  }
  if (status !== undefined) {
    if (!["active", "reported"].includes(status)) throw httpError(400, "circle_status_invalid");
    if (status === "active") match.archivedAt = null;
  }
  if (excludeUserIds.length) match.creatorId = { $nin: excludeUserIds };
  if (city !== undefined && String(city).trim()) {
    match.city = { $regex: `^${escapeRegex(String(city).trim())}$`, $options: "i" };
  }
  if (category) {
    if (!mongoose.isValidObjectId(category)) throw httpError(400, "circle_category_invalid");
    match.category = new mongoose.Types.ObjectId(category);
  }
  if (keyword !== undefined && String(keyword).trim()) {
    const expression = { $regex: escapeRegex(String(keyword).trim()), $options: "i" };
    const organizers = await User.find({ name: expression }).select("_id").limit(1000).lean();
    const organizerCircleIds = organizers.length
      ? await CircleMember.distinct("circleId", {
          userId: { $in: organizers.map((user) => user._id) },
          role: "organizer",
          status: "active",
        })
      : [];
    match.$or = [
      { name: expression },
      { purpose: expression },
      { description: expression },
      { city: expression },
      ...(organizerCircleIds.length ? [{ _id: { $in: organizerCircleIds } }] : []),
    ];
  }
  const pipeline = [{ $match: match }];
  const reportLookup = {
    $lookup: {
      from: UserReport.collection.name,
      let: { circleId: "$_id" },
      pipeline: [
        {
          $match: {
            resourceType: "circle",
            $expr: { $eq: ["$resourceId", "$$circleId"] },
          },
        },
        { $count: "count" },
      ],
      as: "_reportCount",
    },
  };
  const beforeFacet = [
    ...pipeline,
    {
      $lookup: {
        from: Category.collection.name,
        localField: "category",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1 } }],
        as: "category",
      },
    },
    {
      $set: { category: { $first: "$category" } },
    },
  ];
  if (status === "reported") {
    beforeFacet.push(reportLookup, {
      $set: { reports: { $ifNull: [{ $arrayElemAt: ["$_reportCount.count", 0] }, 0] } },
      $match: { reports: { $gt: 0 } },
    });
  }
  const now = new Date();
  const [result, categories] = await Promise.all([
    Circle.aggregate([
      ...beforeFacet,
      {
        $facet: {
          items: [
            { $sort: { createdAt: -1, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $lookup: {
                from: CircleMember.collection.name,
                let: { circleId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      role: "organizer",
                      status: "active",
                      $expr: { $eq: ["$circleId", "$$circleId"] },
                    },
                  },
                  { $limit: 1 },
                  {
                    $lookup: {
                      from: User.collection.name,
                      localField: "userId",
                      foreignField: "_id",
                      pipeline: [{ $project: { name: 1, handle: 1, profileIcon: 1 } }],
                      as: "user",
                    },
                  },
                  { $project: { user: { $first: "$user" } } },
                ],
                as: "_organizer",
              },
            },
            { $set: { organizer: { $first: "$_organizer.user" } } },
          ],
          total: [{ $count: "count" }],
          count: [
            {
              $lookup: {
                from: CircleMember.collection.name,
                let: { circleId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      status: { $in: ["active", "pending", "invited"] },
                      $expr: { $eq: ["$circleId", "$$circleId"] },
                    },
                  },
                  { $group: { _id: "$status", count: { $sum: 1 } } },
                ],
                as: "_memberCounts",
              },
            },
            ...(status === "reported" ? [] : [reportLookup]),
            {
              $set: {
                memberCount: memberCountExpression("active"),
                reports: { $ifNull: [{ $arrayElemAt: ["$_reportCount.count", 0] }, 0] },
                activePools: {
                  $size: {
                    $filter: {
                      input: { $ifNull: ["$polls", []] },
                      as: "poll",
                      cond: {
                        $and: [{ $eq: ["$$poll.status", "active"] }, { $gt: ["$$poll.closesAt", now] }],
                      },
                    },
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                members: { $sum: "$memberCount" },
                reports: { $sum: "$reports" },
                activePools: { $sum: "$activePools" },
              },
            },
          ],
        },
      },
    ]),
    Category.find({ status: "active" }, { _id: 1, name: 1 }).sort({ sortOrder: 1, _id: 1 }).lean(),
  ]);
  const items = result?.[0]?.items || [];
  const totalRecords = result?.[0]?.total?.[0]?.count || 0;
  const voteSummaries = await pollVoteSummaries(items);
  const data = items.map((circle) => {
    const { memberCount, pendingRequestCount, joinedInvitationCount, pendingInvitationCount, ...view } = circleView(
      circle,
      EMPTY_COUNTS,
      voteSummaries,
    );
    return {
      ...view,
      coverImage: circle.coverImage ? getFullImageUrl(circle.coverImage) : "",
      organizer: circle.organizer
        ? {
            _id: idStr(circle.organizer._id),
            name: circle.organizer.name || "",
            handle: circle.organizer.handle || "",
            profileIcon: circle.organizer.profileIcon ? getFullImageUrl(circle.organizer.profileIcon) : "",
          }
        : null,
    };
  });
  const meta = generateMeta(page, limit, totalRecords);
  meta.count = result?.[0]?.count?.[0] || {
    total: 0,
    members: 0,
    reports: 0,
    activePools: 0,
  };
  delete meta.count._id;
  meta.categories = categories;
  meta.privacy = ["open", "invite-only", "approval-required"];
  return { data, meta };
}

async function listCircles(req, { excludeUserIds = [] } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, city, category, lat, lng, radius } = req.query;
  const match = {
    deletedAt: null,
    creatorId: { $exists: true },
    // creatorId: { $ne: req.user._id },
    privacy: { $in: ["open", "approval"] },
  };
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
      Number(lat) < -90 ||
      Number(lat) > 90 ||
      Number(lng) < -180 ||
      Number(lng) > 180)
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
  const circles = result?.items || [];
  const [voteSummaries, viewerMemberships] = await Promise.all([
    pollVoteSummaries(circles),
    req.user?._id && circles.length
      ? CircleMember.find({
          userId: req.user._id,
          circleId: { $in: circles.map((circle) => circle._id) },
          status: "active",
        })
          .select("circleId role")
          .lean()
      : [],
  ]);
  const viewerRoles = new Map(viewerMemberships.map((member) => [String(member.circleId), member.role]));
  const data = circles.map((circle) => {
    const { memberCount, pendingRequestCount, joinedInvitationCount, pendingInvitationCount, ...view } = circleView(
      circle,
      EMPTY_COUNTS,
      voteSummaries,
    );
    return {
      ...view,
      coverImage: circle.coverImage ? getFullImageUrl(circle.coverImage) : "",
      distanceMeters: circle.distanceMeters ?? null,
      viewerRole: viewerRoles.get(String(circle._id)) || "none",
    };
  });
  return { data, meta: generateMeta(page, limit, result?.total?.[0]?.count || 0) };
}

async function listMyCircles(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const { creatorId } = req.query;
  const filter = { _id: { $in: await membership.circleIdsFor(userId) }, deletedAt: null };
  if (creatorId) {
    filter.creatorId = new mongoose.Types.ObjectId(creatorId);
  }
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
  return { data: await presentCircles(items), meta: generateMeta(page, limit, total) };
}

async function latestMembersFor(circleId, viewerId = null) {
  const rows = await CircleMember.find({ circleId, status: "active" })
    .sort({ joinedAt: -1, _id: -1 })
    .limit(LATEST_MEMBERS_LIMIT)
    .select("userId role joinedAt")
    .lean();
  if (!rows.length) return [];
  const userIds = rows.map((row) => row.userId);
  const [users, relationships] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select("name handle profileIcon")
      .lean(),
    viewerId ? getConnectionStatuses(viewerId, userIds) : new Map(),
  ]);
  const userById = new Map(users.map((user) => [String(user._id), user]));
  return rows.map((row) => {
    const id = String(row.userId);
    const user = userById.get(id);
    const relationship = relationships.get(id);
    return {
      userId: id,
      name: user?.name || "",
      handle: user?.handle || "",
      profileIcon: user?.profileIcon ? getFullImageUrl(user.profileIcon) : "",
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt,
      connectionStatus: relationship?.connectionStatus || null,
      canSendConnectionRequest: relationship?.canSendConnectionRequest || false,
    };
  });
}

async function getCircle(circleId, viewerId = null, isAdmin = false) {
  const circle = await loadCircle(circleId);
  const viewerMembership = viewerId ? await membership.getMember(circle._id, viewerId, { status: null }) : null;
  const isMember = viewerMembership?.status === "active";
  if (circle.privacy === "invite_only" && !isMember && !isAdmin) throw httpError(404, "circle_not_found");
  const memberIds = await membership.activeMemberIds(circle._id);
  const [latestEvents, openDrops] = await Promise.all([
    Event.find({ circleId: circle._id, status: "published" }).sort({ date: -1, _id: -1 }).limit(2).lean(),
    Drop.find({
      ownerId: { $in: memberIds },
      status: "open",
      deletedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ createdAt: -1 })
      .select("_id ownerId title status date")
      .lean(),
  ]);
  const voteSummaries = await pollVoteSummaries([circle], viewerId);
  const view = await presentCircle(circle, { includeMembers: isMember || isAdmin, voteSummaries });
  view.viewerMembership = viewerMembership
    ? {
        _id: idStr(viewerMembership._id),
        role: viewerMembership.role,
        status: viewerMembership.status,
        joinedAt: viewerMembership.joinedAt || null,
      }
    : null;
  const [category, organizerIds, latestMembers] = await Promise.all([
    Category.findById(circle.category).select("name").lean(),
    membership.organizerIds(circle._id),
    circle.privacy === "open" || isMember || isAdmin ? latestMembersFor(circle._id, viewerId) : [],
  ]);
  const organizer = organizerIds.length
    ? await User.findById(organizerIds[0]).select("name handle profileIcon").lean()
    : null;
  if (category) view.category = { _id: idStr(category._id), name: category.name || "" };
  view.organizer = organizer
    ? {
        _id: idStr(organizer._id),
        name: organizer.name || "",
        handle: organizer.handle || "",
        profileIcon: organizer.profileIcon ? getFullImageUrl(organizer.profileIcon) : "",
      }
    : null;
  view.latestMembers = latestMembers;
  view.latestEvents = latestEvents.map((event) => ({
    _id: idStr(event._id),
    name: event.name,
    date: event.date,
    status: event.status,
  }));
  const now = new Date();
  view.latestPolls = (circle.polls || [])
    .map((poll) => pollViewForViewer(poll, voteSummaries.get(`${circle._id}:${poll._id}`), now))
    .filter((poll) => poll.status === "active")
    .reverse()
    .slice(0, LATEST_POLLS_LIMIT);
  view.openDrops = openDrops.map((drop) => ({
    _id: idStr(drop._id),
    ownerId: idStr(drop.ownerId),
    title: drop.title || "",
    status: drop.status,
    date: drop.date || null,
  }));
  view.coverImage = circle.coverImage ? getFullImageUrl(circle.coverImage) : "";
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
  const updated = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    if (!circle) throw httpError(404, "circle_not_found");
    const user = await User.findById(userId).lean();
    if (!isAdminUser(user)) await requireOrganizer(circle, userId, session);
    const updatedCircle = await Circle.findByIdAndUpdate(
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
    return updatedCircle;
  });
  return presentCircle(updated);
}

async function joinCircle(userId, circleId) {
  const result = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    const existing = await CircleMember.findOne({ circleId: circle._id, userId }).session(session);
    if (existing?.status === "active") throw httpError(409, "circle_already_joined");
    const status = circle.privacy === "open" ? "active" : circle.privacy === "approval" ? "pending" : null;
    if (!status) throw httpError(403, "circle_invitation_required");
    const joinedAt = status === "active" ? new Date() : null;
    if (existing) {
      const updated = await CircleMember.findOneAndUpdate(
        { _id: existing._id, status: { $in: ["left", "declined", "withdrawn"] } },
        { $set: { role: "member", status, joinedAt } },
        { new: true, session },
      );
      if (!updated) throw httpError(409, "circle_membership_exists");
    } else {
      try {
        await CircleMember.create([{ circleId: circle._id, userId, role: "member", status, joinedAt }], { session });
      } catch (error) {
        if (error?.code === 11000) throw httpError(409, "circle_membership_exists");
        throw error;
      }
    }
    if (status === "active") await addChatMember(circle, userId, session);
    return { status, circle };
  });
  const { status, circle } = result;
  if (status === "pending") {
    const organizerIds = await membership.organizerIds(circle._id);
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
  return { status, circle: await presentCircle(circle) };
}

async function withdrawJoinRequest(userId, circleId) {
  const result = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    const member = await CircleMember.findOneAndUpdate(
      { circleId: circle._id, userId, status: "pending" },
      { $set: { status: "withdrawn" } },
      { new: true, session },
    );
    if (!member) throw httpError(404, "circle_request_not_found");
    return circle;
  });
  const organizerIds = (await membership.organizerIds(result._id)).filter((id) => id !== String(userId));
  if (organizerIds.length) {
    sendUserNotifications({
      recipientIds: organizerIds,
      sender: userId,
      title: "Circle request withdrawn",
      body: `A membership request for ${result.name} was withdrawn.`,
      data: { type: "circle_status", objectType: "circle" },
      objectId: result._id,
    });
  }
  return { status: "withdrawn", circle: await presentCircle(result) };
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

async function decideMembership(userId, circleId, targetUserId, approve, isAdmin = false) {
  const circle = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    if (!isAdmin) await requireOrganizer(circle, userId, session);
    const status = approve ? "active" : "declined";
    const member = await CircleMember.findOneAndUpdate(
      { circleId: circle._id, userId: targetUserId, status: "pending" },
      { $set: { status, joinedAt: approve ? new Date() : null } },
      { new: true, session },
    );
    if (!member) throw httpError(404, "circle_request_not_found");
    if (approve) await addChatMember(circle, targetUserId, session);
    return circle;
  });
  sendUserNotifications({
    recipientIds: [String(targetUserId)],
    sender: userId,
    title: approve ? "Circle request approved" : "Circle request declined",
    body: approve ? "Your Circle membership request was approved." : "Your Circle membership request was declined.",
    data: { type: "circle_status", objectType: "circle" },
    objectId: circle._id,
  });
  return presentCircle(circle);
}

async function inviteUsers(userId, circleId, userIds = []) {
  if (!Array.isArray(userIds) || !userIds.length || userIds.length > 50)
    throw httpError(400, "circle_invite_list_invalid");
  const circle = await loadCircle(circleId);
  await requireOrganizer(circle, userId);
  const ids = await resolveInvitees(userId, userIds);
  if (!ids.length) throw httpError(400, "circle_invite_list_invalid");
  const existing = await CircleMember.find({ circleId: circle._id, userId: { $in: ids } })
    .select("userId status")
    .lean();
  const blocked = new Set(
    existing
      .filter((member) => ["active", "pending", "invited"].includes(member.status))
      .map((member) => String(member.userId)),
  );
  const newlyInvited = ids.filter((id) => !blocked.has(id));
  const operations = newlyInvited.flatMap((id) => [
    {
      updateOne: {
        filter: { circleId: circle._id, userId: id, status: { $in: ["left", "declined", "withdrawn"] } },
        update: { $set: { role: "member", status: "invited", invitedBy: userId, joinedAt: null } },
      },
    },
    {
      updateOne: {
        filter: { circleId: circle._id, userId: id },
        update: {
          $setOnInsert: { role: "member", status: "invited", invitedBy: userId, joinedAt: null },
        },
        upsert: true,
      },
    },
  ]);
  if (operations.length) await CircleMember.bulkWrite(operations);
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
  return presentCircle(circle, { includeMembers: true });
}

async function respondInvitation(userId, circleId, accept) {
  const circle = await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    const status = accept ? "active" : "declined";
    const member = await CircleMember.findOneAndUpdate(
      { circleId: circle._id, userId, status: "invited" },
      { $set: { status, joinedAt: accept ? new Date() : null } },
      { new: true, session },
    );
    if (!member) throw httpError(404, "circle_invitation_not_found");
    if (accept) await addChatMember(circle, userId, session);
    return circle;
  });
  const organizers = (await membership.organizerIds(circle._id)).filter((id) => id !== String(userId));
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
  return presentCircle(circle);
}

async function leaveCircle(userId, circleId) {
  await withTransaction(async (session) => {
    const circle = await loadCircle(circleId, session);
    const member = await requireMember(circle, userId, session);
    if (String(circle.creatorId) === String(userId) || member.role === "organizer") {
      throw httpError(409, "transfer_organizer_or_delete_circle");
    }
    await CircleMember.updateOne({ _id: member._id, status: "active" }, { $set: { status: "left" } }, { session });
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
  await requireOrganizer(circle, userId);
  if (!(await membership.getMember(circle._id, targetUserId))) throw httpError(400, "target_must_be_circle_member");
  const updated = await withTransaction(async (session) => {
    await CircleMember.updateOne(
      { circleId: circle._id, userId, status: "active" },
      { $set: { role: "member" } },
      { session },
    );
    await CircleMember.updateOne(
      { circleId: circle._id, userId: targetUserId, status: "active" },
      { $set: { role: "organizer" } },
      { session },
    );
    const updatedCircle =
      String(circle.creatorId) === String(userId)
        ? await Circle.findByIdAndUpdate(circle._id, { $set: { creatorId: targetUserId } }, { new: true, session })
        : circle;
    await Conversation.updateOne(
      { _id: circle.conversationId },
      { $addToSet: { admins: targetUserId }, $pull: { admins: userId } },
      { session },
    );
    return updatedCircle;
  });
  return presentCircle(updated, { includeMembers: true });
}

async function deleteCircle(userId, circleId) {
  const circle = await loadCircle(circleId);
  if (String(circle.creatorId) !== String(userId)) throw httpError(403, "circle_creator_required");
  return withTransaction(async (session) => {
    const now = new Date();
    await Circle.updateOne({ _id: circle._id, deletedAt: null }, { $set: { deletedAt: now } }, { session });
    await Event.updateMany(
      { circleId: circle._id, status: { $ne: "cancelled" } },
      { $set: { status: "cancelled", cancelledAt: now } },
      { session },
    );
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
  const now = new Date();
  const closesAt =
    body.closesAt === undefined || body.closesAt === null
      ? new Date(now.getTime() + DEFAULT_POLL_DURATION_MS)
      : new Date(body.closesAt);
  if (Number.isNaN(closesAt.getTime()) || closesAt <= now) throw httpError(400, "poll_close_date_invalid");
  const circle = await loadCircle(circleId);
  await requireOrganizer(circle, userId);
  const poll = {
    _id: new mongoose.Types.ObjectId(),
    question: String(body.question).trim(),
    options,
    createdBy: userId,
    closesAt,
    status: "active",
  };
  const updated = await Circle.findOneAndUpdate(
    {
      _id: circle._id,
      deletedAt: null,
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$polls", []] },
                as: "poll",
                cond: {
                  $and: [{ $eq: ["$$poll.status", "active"] }, { $gt: ["$$poll.closesAt", now] }],
                },
              },
            },
          },
          MAX_ACTIVE_POLLS,
        ],
      },
    },
    { $push: { polls: poll } },
    { new: true, runValidators: true },
  );
  if (!updated) throw httpError(409, "active_poll_limit_reached");
  return pollView(updated.polls.find((item) => String(item._id) === String(poll._id)));
}

async function closePoll(userId, circleId, pollId) {
  const circle = await loadCircle(circleId);
  await requireOrganizer(circle, userId);
  const pollObjectId = objectId(pollId, "circle_poll_not_found");
  if (!(circle.polls || []).some((poll) => String(poll._id) === String(pollObjectId))) {
    throw httpError(404, "circle_poll_not_found");
  }
  const now = new Date();
  const updated = await Circle.findOneAndUpdate(
    {
      _id: circle._id,
      deletedAt: null,
      polls: { $elemMatch: { _id: pollObjectId, status: "active", closesAt: { $gt: now } } },
    },
    { $set: { "polls.$.status": "closed", "polls.$.closesAt": now } },
    { new: true, runValidators: true },
  );
  if (!updated) throw httpError(409, "poll_closed");
  const poll = updated.polls.find((item) => String(item._id) === String(pollObjectId));
  const summaries = await pollVoteSummaries([updated], userId);
  return pollViewForViewer(poll, summaries.get(`${updated._id}:${poll._id}`), now);
}

async function votePoll(userId, circleId, pollId, optionIndex) {
  if (optionIndex === undefined) {
    optionIndex = pollId;
    pollId = null;
  }
  if (!Number.isInteger(Number(optionIndex))) throw httpError(400, "poll_option_invalid");
  const circle = await loadCircle(circleId);
  await requireMember(circle, userId);
  const now = new Date();
  let poll = pollId ? (circle.polls || []).find((item) => String(item._id) === String(pollId)) : null;
  if (!pollId) {
    const activePolls = (circle.polls || []).filter((item) => item.status === "active" && item.closesAt > now);
    if (activePolls.length > 1) throw httpError(400, "poll_id_required");
    poll = activePolls[0];
  }
  if (!poll || poll.status !== "active" || poll.closesAt <= new Date()) throw httpError(409, "poll_closed");
  const index = Number(optionIndex);
  if (index < 0 || index >= poll.options.length) throw httpError(400, "poll_option_invalid");
  try {
    await withTransaction(async (session) => {
      const updated = await Circle.updateOne(
        {
          _id: circle._id,
          deletedAt: null,
          polls: { $elemMatch: { _id: poll._id, status: "active", closesAt: { $gt: new Date() } } },
        },
        { $inc: { "polls.$.voteVersion": 1 } },
        { session },
      );
      if (!updated.matchedCount) throw httpError(409, "poll_vote_duplicate_or_closed");
      await CirclePollVote.create(
        [{ circleId: circle._id, pollId: poll._id, userId, optionIndex: index, votedAt: now }],
        { session },
      );
    });
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, "poll_vote_duplicate_or_closed");
    throw error;
  }
  const summaries = await pollVoteSummaries([circle], userId);
  return pollViewForViewer(poll, summaries.get(`${circle._id}:${poll._id}`), new Date());
}

async function listPolls(userId, circleId, req) {
  const circle = await loadCircle(circleId);
  if (!isAdminUser(req.user)) await requireMember(circle, userId);
  const { status } = req.query;
  if (status !== undefined && !["active", "closed"].includes(status)) throw httpError(400, "poll_status_invalid");
  const { page, limit } = parsePaginationParams(req);
  const now = new Date();
  const summaries = await pollVoteSummaries([circle], userId);
  const polls = (circle.polls || [])
    .map((poll) => pollViewForViewer(poll, summaries.get(`${circle._id}:${poll._id}`), now))
    .filter((poll) => !status || poll.status === status)
    .reverse();
  return {
    data: polls.slice((page - 1) * limit, page * limit),
    meta: generateMeta(page, limit, polls.length),
  };
}

async function getPoll(userId, circleId, pollId, isAdmin = false) {
  const circle = await loadCircle(circleId);
  if (!isAdmin) await requireMember(circle, userId);
  const pollObjectId = objectId(pollId, "circle_poll_not_found");
  const poll = (circle.polls || []).find((item) => String(item._id) === String(pollObjectId));
  if (!poll) throw httpError(404, "circle_poll_not_found");
  const summaries = await pollVoteSummaries([circle], userId);
  return { ...pollViewForViewer(poll, summaries.get(`${circle._id}:${poll._id}`)), circleId: idStr(circle._id) };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function toggleSuspendCircle(userId, circleId, isAdmin = false) {
  const circle = await loadCircle(circleId);
  if (!isAdmin) await requireOrganizer(circle, userId);
  circle.status = circle.status === "inactive" ? "active" : "inactive";
  await circle.save();
  return presentCircle(circle);
}

module.exports = {
  toggleSuspendCircle,
  createCircle,
  listCircles,
  listAllCircles,
  listMyCircles,
  getCircle,
  listMembers,
  updateCircle,
  joinCircle,
  withdrawJoinRequest,
  decideMembership,
  inviteUsers,
  respondInvitation,
  leaveCircle,
  transferOrganizer,
  deleteCircle,
  createPoll,
  closePoll,
  listPolls,
  getPoll,
  votePoll,
};
