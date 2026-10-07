const repo = require("./tradeRepository");
const authRepo = require("../auth/authRepository");
function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

async function requireUser(userId) {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) throw AppError("account_not_found", 401);
  return user;
}

function toPublicTrade(trade) {
  return {
    _id: trade._id,
    dropId: trade.dropId,
    tapInId: trade.tapInId,
    ownerId: trade.ownerId,
    applicantId: trade.applicantId,
    status: trade.status,
    completionProposedBy: trade.completionProposedBy || null,
    completionProposedAt: trade.completionProposedAt || null,
    completionPhotoUrl: trade.completionPhotoUrl || null,
    completedAt: trade.completedAt || null,
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
  };
}

async function requireTrade(tradeId) {
  const trade = await repo.findById(tradeId);
  if (!trade) throw AppError("trade_not_found", 404);
  return trade;
}

function requireParticipant(trade, userId) {
  const uid = String(userId);
  if (uid !== String(trade.ownerId) && uid !== String(trade.applicantId)) {
    throw AppError("access_denied", 403);
  }
}

function otherParticipantId(trade, userId) {
  if (String(userId) === String(trade.ownerId)) return trade.applicantId;
  return trade.ownerId;
}

async function proposeComplete(userId, tradeId, body = {}) {
  const trade = await requireTrade(tradeId);
  requireParticipant(trade, userId);

  if (trade.status !== "in_progress") {
    throw AppError("trade_not_in_progress", 409);
  }

  const photo = body.completionPhotoUrl || body.photoUrl || body.imageUrl || null;

  const updated = await repo.update(tradeId, {
    status: "completion_proposed",
    completionProposedBy: userId,
    completionProposedAt: new Date().toISOString(),
    completionPhotoUrl: photo ? String(photo) : null,
  });

  return toPublicTrade(updated);
}

async function confirmComplete(userId, tradeId) {
  const trade = await requireTrade(tradeId);
  requireParticipant(trade, userId);

  if (trade.status !== "completion_proposed") {
    throw AppError("trade_not_completion_proposed", 409);
  }
  if (String(trade.completionProposedBy) === String(userId)) {
    throw AppError("cannot_confirm_own_proposal", 403);
  }

  const updated = await repo.update(tradeId, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });

  return toPublicTrade(updated);
}

async function rejectComplete(userId, tradeId) {
  const trade = await requireTrade(tradeId);
  requireParticipant(trade, userId);

  if (trade.status !== "completion_proposed") {
    throw AppError("trade_not_completion_proposed", 409);
  }
  if (String(trade.completionProposedBy) === String(userId)) {
    throw AppError("cannot_reject_own_proposal", 403);
  }

  const updated = await repo.update(tradeId, {
    status: "in_progress",
    completionProposedBy: null,
    completionProposedAt: null,
    completionPhotoUrl: null,
  });

  return toPublicTrade(updated);
}

async function createReview(userId, tradeId, body = {}) {
  // Auth + verified/onboarded enforced by route middleware
  const user = await requireUser(userId);
  const trade = await requireTrade(tradeId);
  requireParticipant(trade, userId);

  if (trade.status !== "completed") {
    throw AppError("review_not_allowed", 403);
  }

  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw AppError("stars_required", 400);
  }

  let reviewBody = "";
  if (body.body !== undefined && body.body !== null) {
    reviewBody = String(body.body);
    if (reviewBody.length > 400) throw AppError("review_body_too_long", 400);
  }

  if (await repo.findReviewByTradeAndFrom(tradeId, userId)) {
    throw AppError("review_duplicate", 409);
  }

  const toUserId = otherParticipantId(trade, userId);
  if (String(toUserId) === String(userId)) {
    throw AppError("cannot_review_self", 403);
  }

  const toUser = await authRepo.findById(toUserId);

  const review = await repo.createReview({
    tradeId: trade._id,
    fromUserId: user._id,
    toUserId,
    fromHandle: user.handle || "",
    toHandle: toUser?.handle || "",
    stars,
    body: reviewBody,
  });

  return {
    _id: review._id,
    tradeId: review.tradeId,
    fromUserId: review.fromUserId,
    toUserId: review.toUserId,
    stars: review.stars,
    body: review.body,
    createdAt: review.createdAt,
  };
}

async function ratingForUser(userId) {
  const received = await repo.listReviewsReceivedBy(userId);
  if (!received.length) return null;
  const sum = received.reduce((acc, r) => acc + Number(r.stars), 0);
  const average = Math.round((sum / received.length) * 10) / 10;
  return { average, count: received.length };
}

async function collaboratorsForUser(userId, limit = 12) {
  const uid = String(userId);
  const completed = (await repo.list())
    .filter((t) => t.status === "completed")
    .filter((t) => String(t.ownerId) === uid || String(t.applicantId) === uid)
    .sort((a, b) => String(b.completedAt || b.updatedAt).localeCompare(String(a.completedAt || a.updatedAt)));

  const seen = new Set();
  const out = [];
  for (const t of completed) {
    const otherId = String(t.ownerId) === uid ? t.applicantId : t.ownerId;
    if (seen.has(String(otherId))) continue;
    seen.add(String(otherId));
    const other = await authRepo.findById(otherId);
    if (!other || other.deletedAt) continue;
    out.push({
      _id: other._id,
      handle: other.handle || "",
      avatarUrl: other.avatarUrl || "",
      name: other.name || "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  proposeComplete,
  confirmComplete,
  rejectComplete,
  createReview,
  ratingForUser,
  collaboratorsForUser,
  toPublicTrade,
  AppError,
};
