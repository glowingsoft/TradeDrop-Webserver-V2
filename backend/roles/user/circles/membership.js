const CircleMember = require("@models/CircleMember");

function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function getMember(circleId, userId, { session = null, status = "active" } = {}) {
  if (!userId) return null;
  const filter = { circleId, userId };
  if (status) filter.status = status;
  return withSession(CircleMember.findOne(filter).lean(), session);
}

async function organizerIds(circleId, session = null) {
  const rows = await withSession(
    CircleMember.find({ circleId, status: "active", role: "organizer" }).select("userId").lean(),
    session,
  );
  return rows.map((row) => String(row.userId));
}

async function activeMemberIds(circleId, session = null) {
  const rows = await withSession(CircleMember.find({ circleId, status: "active" }).select("userId").lean(), session);
  return rows.map((row) => row.userId);
}

async function circleIdsFor(userId, filter = {}) {
  if (!userId) return [];
  return CircleMember.distinct("circleId", { userId, status: "active", ...filter });
}

async function countsFor(circleIds) {
  const rows = await CircleMember.aggregate([
    { $match: { circleId: { $in: circleIds }, status: { $in: ["active", "pending", "invited"] } } },
    {
      $group: {
        _id: { circleId: "$circleId", status: "$status" },
        count: { $sum: 1 },
        invited: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$invitedBy", null] }, null] }, 1, 0] } },
      },
    },
  ]);
  const counts = new Map();
  for (const row of rows) {
    const key = String(row._id.circleId);
    const entry = counts.get(key) || {
      memberCount: 0,
      pendingRequestCount: 0,
      pendingInvitationCount: 0,
      joinedInvitationCount: 0,
    };
    if (row._id.status === "active") {
      entry.memberCount = row.count;
      entry.joinedInvitationCount = row.invited;
    } else if (row._id.status === "pending") {
      entry.pendingRequestCount = row.count;
    } else {
      entry.pendingInvitationCount = row.count;
    }
    counts.set(key, entry);
  }
  return counts;
}

module.exports = { getMember, organizerIds, activeMemberIds, circleIdsFor, countsFor };
