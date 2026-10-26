const mongoose = require("mongoose");
const { User } = require("@UsersModel");
const Trade = require("@models/Trade");
const Review = require("@models/Review");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { idStr, idStrOrNull, httpError } = require("../_shared/serialize");
const {
  withTransaction,
  toObjectId,
  escapeRegex,
  textOrEmpty,
  sideOf,
  otherParty,
  userBrief,
  usersById,
  toTradeView,
  loadTrade,
  requireParty,
  reopenDrop,
  completeTradeInSession,
  afterCompletion,
} = require("../_shared/tradeShared");
async function markDone(tradeId, userId, proof = "") {
  const id = toObjectId(tradeId, "trade_not_found");
  const proofValue = textOrEmpty(proof, 1000, "proof_too_long");

  const result = await withTransaction(async (session) => {
    const trade = await loadTrade(id, session);
    requireParty(trade, userId);
    if (trade.disputeId || trade.status !== "active") throw httpError(409, "invalid_status_transition");

    const side = sideOf(trade, userId);
    const marked = await Trade.findOneAndUpdate(
      { _id: id, status: "active", disputeId: null, [`${side}.doneAt`]: null },
      { $set: { [`${side}.doneAt`]: new Date(), [`${side}.proof`]: proofValue } },
      { new: true, session },
    ).lean();
    if (!marked) throw httpError(409, "already_marked_done");

    const other = side === "requester" ? "responder" : "requester";
    if (!marked[other]?.doneAt) return { trade: marked, completed: false };

    const completed = await completeTradeInSession({ _id: id, disputeId: null }, session);
    if (!completed) throw httpError(409, "invalid_status_transition");
    return { trade: completed, completed: true };
  });

  if (result.completed) await afterCompletion(result.trade);
  return toTradeView(result.trade);
}

async function cancelTrade(tradeId, userId) {
  const id = toObjectId(tradeId, "trade_not_found");
  return withTransaction(async (session) => {
    const cancelled = await Trade.findOneAndUpdate(
      { _id: id, status: "active", disputeId: null, $or: [{ requesterId: userId }, { responderId: userId }] },
      { $set: { status: "cancelled" } },
      { new: true, session },
    ).lean();
    if (!cancelled) {
      const trade = await loadTrade(id, session);
      requireParty(trade, userId);
      throw httpError(409, "invalid_status_transition");
    }
    await reopenDrop(cancelled.dropId, session);
    return toTradeView(cancelled);
  });
}

async function getTrade(tradeId, actor) {
  const trade = await loadTrade(tradeId);
  if (!actor.isAdmin) requireParty(trade, actor._id);
  return toTradeView(trade);
}

async function listMyTrades(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const query = { $or: [{ requesterId: userId }, { responderId: userId }] };
  if (req.query.status) query.status = String(req.query.status);
  const [items, total] = await Promise.all([
    Trade.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Trade.countDocuments(query),
  ]);
  const users = await usersById(items.map((t) => otherParty(t, userId)));
  return {
    data: items.map((t) => ({ ...toTradeView(t), counterparty: userBrief(users.get(String(otherParty(t, userId)))) })),
    meta: generateMeta(page, limit, total),
  };
}

async function listMyCollaborations(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const query = {
    kind: "collaboration",
    $or: [{ requesterId: userId }, { responderId: userId }],
  };
  if (req.query.status) query.status = String(req.query.status);
  const [items, total] = await Promise.all([
    Trade.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Trade.countDocuments(query),
  ]);
  const users = await usersById(items.map((t) => otherParty(t, userId)));
  return {
    data: items.map((t) => ({ ...toTradeView(t), counterparty: userBrief(users.get(String(otherParty(t, userId)))) })),
    meta: generateMeta(page, limit, total),
  };
}

async function createReview(tradeId, userId, body = {}) {
  const trade = await loadTrade(tradeId);
  requireParty(trade, userId);
  if (trade.status !== "completed" || trade.disputeId) throw httpError(409, "review_not_allowed");

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, "rating_required");
  const comment = textOrEmpty(body.comment, 400, "review_body_too_long");

  try {
    const review = await Review.create({
      tradeId: trade._id,
      reviewerId: userId,
      revieweeId: otherParty(trade, userId),
      rating,
      comment,
    });
    return {
      _id: idStr(review._id),
      tradeId: idStr(review.tradeId),
      reviewerId: idStr(review.reviewerId),
      revieweeId: idStr(review.revieweeId),
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
    };
  } catch (err) {
    if (err && err.code === 11000) throw httpError(409, "review_duplicate");
    throw err;
  }
}

async function getAllReviews({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, tradeId, reviewerId, revieweeId, rating } = req.query;
  const match = { ...filter };
  const setId = (key, val) => {
    if (val && mongoose.isValidObjectId(val)) match[key] = new mongoose.Types.ObjectId(val);
  };
  setId("tradeId", tradeId);
  setId("reviewerId", reviewerId);
  setId("revieweeId", revieweeId);
  if (Number.isInteger(Number(rating)) && Number(rating) >= 1 && Number(rating) <= 5) match.rating = Number(rating);
  if (keyword?.trim()) match.comment = { $regex: escapeRegex(keyword.trim()), $options: "i" };

  const userLookup = (localField, as) => ({
    $lookup: {
      from: "users",
      localField,
      foreignField: "_id",
      pipeline: [{ $project: { _id: 1, name: 1, handle: 1, profileIcon: 1 } }],
      as,
    },
  });
  const [result] = await Review.aggregate([
    { $match: match },
    {
      $facet: {
        reviews: [
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          userLookup("reviewerId", "reviewer"),
          userLookup("revieweeId", "reviewee"),
          { $set: { reviewer: { $first: "$reviewer" }, reviewee: { $first: "$reviewee" } } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);
  const total = result?.total?.[0]?.count || 0;
  return { data: result?.reviews || [], meta: generateMeta(page, limit, total) };
}

async function ratingForUser(userId) {
  const [row] = await Review.aggregate([
    { $match: { revieweeId: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: null, sum: { $sum: "$rating" }, count: { $sum: 1 } } },
  ]);
  if (!row) return null;
  return { average: Math.round((row.sum / row.count) * 10) / 10, count: row.count };
}

async function collaboratorsForUser(userId, limit = 12) {
  const trades = await Trade.find({
    status: "completed",
    $or: [{ requesterId: userId }, { responderId: userId }],
  })
    .sort({ completedAt: -1 })
    .limit(200)
    .select("requesterId responderId")
    .lean();
  const otherIds = [...new Set(trades.map((t) => String(otherParty(t, userId))))];
  const users = await User.find({ _id: { $in: otherIds }, deletedAt: null })
    .select("name handle profileIcon")
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return otherIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, limit)
    .map((u) => ({ _id: u._id, handle: u.handle || "", profileIcon: u.profileIcon || "", name: u.name || "" }));
}

const STATUSES = ["active", "completed", "cancelled"];
const KINDS = ["drop", "proposal", "collaboration"];
const SORTS = { createdAt: "createdAt", updatedAt: "updatedAt", completedAt: "completedAt" };

const groupCounts = (rows) => {
  const out = { all: 0, active: 0, completed: 0, cancelled: 0 };
  for (const r of rows) {
    out[r._id] = r.count;
    out.all += r.count;
  }
  return out;
};

async function listTrades(req) {
  const { page, limit } = parsePaginationParams(req);
  const { status, kind, keyword, userId, dropId, hasDispute, from, to, sortBy, sortOrder } = req.query;
  const tz = req.user?.timezone || "UTC";

  const base = {};
  if (KINDS.includes(kind)) base.kind = kind;
  if (dropId && mongoose.isValidObjectId(dropId)) base.dropId = new mongoose.Types.ObjectId(dropId);
  if (hasDispute === "true") base.disputeId = { $ne: null };
  if (hasDispute === "false") base.disputeId = null;
  if (from || to) {
    base.createdAt = {};
    if (from) base.createdAt.$gte = moment.tz(from, tz).startOf("day").toDate();
    if (to) base.createdAt.$lte = moment.tz(to, tz).endOf("day").toDate();
  }

  const and = [];
  if (userId && mongoose.isValidObjectId(userId)) {
    const id = new mongoose.Types.ObjectId(userId);
    and.push({ $or: [{ requesterId: id }, { responderId: id }] });
  }
  if (keyword?.trim()) {
    const regex = { $regex: escapeRegex(keyword.trim()), $options: "i" };
    const users = await User.find({ $or: [{ name: regex }, { handle: regex }, { email: regex }] })
      .select("_id")
      .limit(500)
      .lean();
    const ids = users.map((u) => u._id);
    and.push({ $or: [{ requesterId: { $in: ids } }, { responderId: { $in: ids } }, { dropOwnerId: { $in: ids } }] });
  }
  if (and.length) base.$and = and;

  const match = STATUSES.includes(status) ? { ...base, status } : base;
  const sort = { [SORTS[sortBy] || "createdAt"]: sortOrder === "asc" ? 1 : -1, _id: -1 };

  const [items, total, counts] = await Promise.all([
    Trade.find(match)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("requesterId", "name handle email profileIcon")
      .populate("responderId", "name handle email profileIcon")
      .populate("dropId", "needText offerText status areaLabel")
      .populate("tapInId", "notes status")
      .lean(),
    Trade.countDocuments(match),
    // status counts honor every filter except status itself
    Trade.aggregate([{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const meta = generateMeta(page, limit, total);
  meta.statusCounts = groupCounts(counts);
  return { data: items, meta };
}

module.exports = {
  markDone,
  cancelTrade,
  getTrade,
  listMyTrades,
  listMyCollaborations,
  createReview,
  getAllReviews,
  ratingForUser,
  collaboratorsForUser,
  listTrades,
};
