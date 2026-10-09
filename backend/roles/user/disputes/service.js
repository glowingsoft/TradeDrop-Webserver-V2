const moment = require("moment-timezone");
const { User } = require("@UsersModel");
const Trade = require("@models/Trade");
const { Dispute } = require("@models/Dispute");
const Connection = require("@models/Connection");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { idStr, idStrOrNull, httpError } = require("../_shared/serialize");
const {
  withTransaction,
  toObjectId,
  textOrEmpty,
  stringArray,
  otherParty,
  toTradeView,
  toDisputeView,
  loadTrade,
  requireParty,
  reopenDrop,
  completeTradeInSession,
  afterCompletion,
  DISPUTE_WINDOW_DAYS,
  MAX_OPEN_DISPUTES,
  DISPUTE_REASONS,
  DISPUTE_OUTCOMES,
  DISPUTE_PRIORITIES,
  DISPUTE_STATUSES,
} = require("../_shared/tradeShared");

async function raiseDispute(tradeId, userId, body = {}) {
  const id = toObjectId(tradeId, "trade_not_found");
  if (!DISPUTE_REASONS.includes(body.reason)) throw httpError(400, "dispute_reason_invalid");
  const priority = body.priority === undefined ? "medium" : body.priority;
  if (!DISPUTE_PRIORITIES.includes(priority)) throw httpError(400, "dispute_priority_invalid");
  const description = textOrEmpty(body.description, 2000, "description_too_long");
  if (!description) throw httpError(400, "description_required");
  const evidence = stringArray(body.evidence, 10, "evidence_invalid");

  return withTransaction(async (session) => {
    const trade = await loadTrade(id, session);
    requireParty(trade, userId);
    if (trade.status === "cancelled") throw httpError(409, "trade_cancelled");
    if (trade.disputeId) {
      const linkedOpen = await Dispute.exists({ _id: trade.disputeId, status: "open" }).session(session);
      if (linkedOpen) throw httpError(409, "dispute_already_open");
      // Stale link to a resolved or missing dispute: clear it so a new one can be raised
      await Trade.updateOne({ _id: trade._id, disputeId: trade.disputeId }, { $set: { disputeId: null } }, { session });
      trade.disputeId = null;
    }
    if (
      trade.status === "completed" &&
      (!trade.completedAt || moment(trade.completedAt).add(DISPUTE_WINDOW_DAYS, "days").isBefore(moment()))
    ) {
      throw httpError(409, "dispute_window_closed");
    }
    const openCount = await Dispute.countDocuments({ raisedBy: userId, status: "open" }).session(session);
    if (openCount >= MAX_OPEN_DISPUTES) throw httpError(409, "too_many_open_disputes");

    const [dispute] = await Dispute.create(
      [
        {
          tradeId: trade._id,
          raisedBy: userId,
          against: otherParty(trade, userId),
          reason: body.reason,
          priority,
          description,
          evidence,
          status: "open",
        },
      ],
      { session },
    );
    const linked = await Trade.findOneAndUpdate(
      { _id: trade._id, disputeId: null, status: { $in: ["active", "completed"] } },
      { $set: { disputeId: dispute._id } },
      { new: true, session },
    );
    if (!linked) throw httpError(409, "invalid_status_transition");
    return toDisputeView(dispute.toObject());
  });
}

async function respondDispute(disputeId, userId, body = {}) {
  const id = toObjectId(disputeId, "dispute_not_found");
  const response = textOrEmpty(body.response, 2000, "response_too_long");
  if (!response) throw httpError(400, "response_required");
  const responseEvidence = stringArray(body.responseEvidence ?? body.evidence, 10, "evidence_invalid");

  const updated = await Dispute.findOneAndUpdate(
    { _id: id, against: userId, status: "open", respondedAt: null },
    { $set: { response, responseEvidence, respondedAt: new Date() } },
    { new: true },
  ).lean();
  if (updated) return toDisputeView(updated);

  const existing = await Dispute.findById(id).lean();
  if (!existing) throw httpError(404, "dispute_not_found");
  if (String(existing.against) !== String(userId)) throw httpError(403, "access_denied");
  throw httpError(409, "invalid_status_transition");
}

async function resolveDispute(disputeId, actor, body = {}) {
  if (!actor.isAdmin) throw httpError(403, "access_denied");
  const id = toObjectId(disputeId, "dispute_not_found");
  if (!DISPUTE_OUTCOMES.includes(body.outcome)) throw httpError(400, "dispute_outcome_invalid");
  const resolutionNote = textOrEmpty(body.resolutionNote, 2000, "resolution_note_too_long");
  const internalNote = textOrEmpty(body.internalNote, 2000, "internal_note_too_long");
  const faultUserId = body.faultUserId ? toObjectId(body.faultUserId, "user_not_found") : null;

  const result = await applyResolution(id, {
    outcome: body.outcome,
    faultUserId,
    resolvedBy: actor._id,
    resolutionType: body.resolutionType ?? "admin",
    resolutionNote,
    ...(internalNote ? { internalNote } : {}),
  });
  return { dispute: toDisputeView(result.dispute, { includeInternal: true }), trade: result.trade };
}

async function applyResolution(
  id,
  { outcome, faultUserId, resolvedBy, resolutionType, resolutionNote, internalNote },
  extraMatch = {},
) {
  const { dispute, trade } = await withTransaction(async (session) => {
    const resolved = await Dispute.findOneAndUpdate(
      { _id: id, status: "open", ...extraMatch },
      {
        $set: {
          status: "resolved",
          outcome,
          faultUserId,
          resolvedBy,
          resolutionType,
          resolutionNote,
          ...(internalNote !== undefined ? { internalNote } : {}),
          resolvedAt: new Date(),
        },
      },
      { new: true, session },
    ).lean();
    if (!resolved) {
      const existing = await Dispute.findById(id).session(session).lean();
      if (!existing) throw httpError(404, "dispute_not_found");
      throw httpError(409, "invalid_status_transition");
    }
    if (faultUserId && ![String(resolved.raisedBy), String(resolved.against)].includes(String(faultUserId))) {
      throw httpError(400, "fault_user_invalid");
    }

    const base = { _id: resolved.tradeId, disputeId: resolved._id };
    let trade = null;

    if (outcome === "complete") {
      trade = await completeTradeInSession(base, session, { disputeId: null });
    } else if (outcome === "cancel") {
      const before = await Trade.findOneAndUpdate(
        { ...base, status: { $in: ["active", "completed"] } },
        { $set: { status: "cancelled", disputeId: null } },
        { new: false, session },
      ).lean();
      if (before) {
        trade = { ...before, status: "cancelled", disputeId: null };
        await reopenDrop(before.dropId, session);
        if (before.status === "completed") {
          // The completion no longer stands, so take it back off the connection count
          await Connection.updateOne(
            { pairKey: Connection.pairKeyFor(before.requesterId, before.responderId), completedCount: { $gt: 0 } },
            { $inc: { completedCount: -1 } },
            { session },
          );
        }
      }
    }
    // dismissed, or the trade was already completed: the trade simply continues
    if (!trade) {
      trade = await Trade.findOneAndUpdate(base, { $set: { disputeId: null } }, { new: true, session }).lean();
    }
    if (faultUserId) {
      await User.updateOne({ _id: faultUserId }, { $inc: { "stats.disputesLost": 1 } }, { session });
    }
    return { dispute: resolved, trade };
  });

  if (trade && outcome === "complete" && trade.status === "completed") await afterCompletion(trade);
  return { dispute, trade: trade ? toTradeView(trade) : null };
}

async function loadPartyDispute(disputeId, userId) {
  const id = toObjectId(disputeId, "dispute_not_found");
  const existing = await Dispute.findById(id).lean();
  if (!existing) throw httpError(404, "dispute_not_found");
  if (![String(existing.raisedBy), String(existing.against)].includes(String(userId))) {
    throw httpError(403, "access_denied");
  }
  return existing;
}

// Admin closes the dispute as settled between the parties: no confirmation needed, no one at fault
async function mutualResolveDispute(disputeId, actor, body = {}) {
  if (!actor.isAdmin) throw httpError(403, "access_denied");
  const id = toObjectId(disputeId, "dispute_not_found");
  const outcome = body.outcome === undefined ? "dismissed" : body.outcome;
  if (!DISPUTE_OUTCOMES.includes(outcome)) throw httpError(400, "dispute_outcome_invalid");
  const resolutionNote = textOrEmpty(body.resolutionNote, 2000, "resolution_note_too_long");
  const internalNote = textOrEmpty(body.internalNote, 2000, "internal_note_too_long");

  const result = await applyResolution(id, {
    outcome,
    faultUserId: null,
    resolvedBy: actor._id,
    resolutionType: "mutual",
    resolutionNote,
    ...(internalNote ? { internalNote } : {}),
  });
  return { dispute: toDisputeView(result.dispute, { includeInternal: true }), trade: result.trade };
}

const USER_FIELDS = { _id: 1, name: 1, email: 1, profileIcon: 1 };

function partyView(u, fallbackId) {
  if (!u || !u._id) return { _id: idStrOrNull(fallbackId) };
  return {
    _id: idStr(u._id),
    name: u.name || "",
    email: u.email || "",
    profileIcon: getFullImageUrl(u.profileIcon || "noimage.png"),
  };
}

async function getDisputes(req, filter = {}) {
  const actor = { _id: req.user._id, isAdmin: req.user.isAdmin ?? req.user.userType === "admin" };
  const { page, limit } = parsePaginationParams(req);
  const base = { ...filter };
  if (!(actor.isAdmin && req.query.scope === "all")) {
    base.$or = [{ raisedBy: actor._id }, { against: actor._id }];
  }
  const stats = {
    status: DISPUTE_STATUSES,
    priority: DISPUTE_PRIORITIES,
    outcome: [...DISPUTE_OUTCOMES, null],
    reason: DISPUTE_REASONS,
  };
  // Query filters narrow the list and total only; the stats keep counting the whole scope
  const query = req.query || {};
  const filters = {};
  for (const field of ["status", "priority", "reason"]) {
    if (stats[field].includes(query[field])) filters[field] = query[field];
  }
  if (query.outcome === "none") filters.outcome = null;
  else if (DISPUTE_OUTCOMES.includes(query.outcome)) filters.outcome = query.outcome;
  if (query.escalated === "true") filters.escalatedAt = { $ne: null };
  const narrow = Object.keys(filters).length ? [{ $match: filters }] : [];
  const userLookup = (field) => [
    {
      $lookup: {
        from: "users",
        localField: field,
        foreignField: "_id",
        pipeline: [{ $project: USER_FIELDS }],
        as: `${field}User`,
      },
    },
    { $unwind: { path: `$${field}User`, preserveNullAndEmptyArrays: true } },
  ];
  const tradeLookup = (field) => [
    {
      $lookup: {
        from: "trades",
        localField: field,
        foreignField: "_id",
        pipeline: [
          {
            $lookup: {
              from: "drops",
              localField: "dropId",
              foreignField: "_id",
              pipeline: [{ $project: { needText: 1, offerText: 1, status: 1, areaLabel: 1 } }],
              as: "dropIdDrop",
            },
          },
          { $unwind: { path: "$dropIdDrop", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "tapins",
              localField: "tapInId",
              foreignField: "_id",
              pipeline: [{ $project: { yourOffer: 1, status: 1 } }],
              as: "tapInIdTapIn",
            },
          },
          { $unwind: { path: "$tapInIdTapIn", preserveNullAndEmptyArrays: true } },
          { $project: { dropIdDrop: 1, tapInIdTapIn: 1, status: 1, kind: 1, tradeCode: 1, _id: 1 } },
        ],
        as: `${field}Trade`,
      },
    },
    { $unwind: { path: `$${field}Trade`, preserveNullAndEmptyArrays: true } },
  ];
  const [result] = await Dispute.aggregate([
    { $match: base },
    {
      $facet: {
        items: [
          ...narrow,
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          ...userLookup("raisedBy"),
          ...userLookup("against"),
          ...tradeLookup("tradeId"),
        ],
        total: [...narrow, { $count: "count" }],
        status: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        priority: [{ $group: { _id: "$priority", count: { $sum: 1 } } }],
        outcome: [{ $group: { _id: "$outcome", count: { $sum: 1 } } }],
        reason: [{ $group: { _id: "$reason", count: { $sum: 1 } } }],
      },
    },
  ]);
  const total = result?.total?.[0]?.count || 0;
  const countOf = (s, field) => result?.[field]?.find((x) => x._id === s)?.count || 0;
  const meta = generateMeta(page, limit, total);
  meta.stats = {};
  for (const [field, values] of Object.entries(stats)) {
    meta.stats[field] = {};
    for (const v of values) meta.stats[field][v === null ? "none" : v] = countOf(v, field);
  }

  const data = (result?.items || []).map((d) => ({
    ...toDisputeView({ ...d, tradeId: d.tradeIdTrade || d.tradeId }, { includeInternal: actor.isAdmin }),
    raisedBy: partyView(d.raisedByUser, d.raisedBy),
    against: partyView(d.againstUser, d.against),
  }));
  return { data, meta };
}

async function getDispute(disputeId, actor) {
  const _id = toObjectId(disputeId, "dispute_not_found");
  const req = {
    user: actor,
    query: { page: 1, limit: 1, ...(actor.isAdmin ? { scope: "all" } : {}) },
  };
  const { data } = await getDisputes(req, { _id });
  if (data[0]) return data[0];
  if (await Dispute.exists({ _id })) throw httpError(403, "access_denied");
  throw httpError(404, "dispute_not_found");
}

module.exports = {
  raiseDispute,
  respondDispute,
  resolveDispute,
  mutualResolveDispute,
  getDisputes,
  getDispute,
};
