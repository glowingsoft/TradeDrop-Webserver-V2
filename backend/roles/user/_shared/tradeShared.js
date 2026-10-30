const mongoose = require("mongoose");
const { User } = require("@UsersModel");
const { Drop } = require("@models/Drop");
const Trade = require("@models/Trade");
const TimingChip = require("@models/TimingChip");
const { createActivity, activityTypes } = require("@helperUtils/activityUtil");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { isBlockedBetween, isActivelyConnected, recordCompletedTrade } = require("@helperUtils/connectionUtil");
const { checkAndAwardBadges } = require("@backend/roles/admin/badges/badgeEngine");
const { idStr, idStrOrNull, httpError } = require("./serialize");

const DISPUTE_WINDOW_DAYS = 7;
const MAX_OPEN_DISPUTES = 3;
const DIRECT_KINDS = ["proposal", "collaboration"];
const DISPUTE_REASONS = [
  "work_not_delivered",
  "not_as_agreed",
  "quality_below_agreed",
  "stopped_responding",
  "late_no_update",
  "unsafe_behavior",
  "other",
];
const DISPUTE_PRIORITIES = ["low", "medium", "high", "urgent"];
const DISPUTE_STATUSES = ["open", "resolved"];
const DISPUTE_OUTCOMES = [
  "finish_agreed_work",
  "redo_part",
  "agree_scope_first",
  "cancel",
  "need_reply",
  "complete",
  "dismissed",
];

const MAX_ACTIVE_TRADES = 2;
const MAX_EXPIRATION_DAYS = 365;
const LOCATION_TYPES = ["neighborhood", "specific", "remote"];
const EXPIRATION_UNIT_MS = {
  h: 3600000,
  hr: 3600000,
  hrs: 3600000,
  hour: 3600000,
  hours: 3600000,
  d: 86400000,
  day: 86400000,
  days: 86400000,
  w: 604800000,
  week: 604800000,
  weeks: 604800000,
};

// "24h" | "3days" | "1 week" -> Date, empty -> null
function parseExpiration(value, now = new Date()) {
  if (value === undefined || value === null || value === "") return null;
  const m = /^(\d+)\s*([a-z]+)$/.exec(String(value).trim().toLowerCase());
  const unit = m && EXPIRATION_UNIT_MS[m[2]];
  const amount = m ? Number(m[1]) : 0;
  if (!unit || amount < 1 || amount * unit > MAX_EXPIRATION_DAYS * 86400000) throw httpError(400, "expiration_invalid");
  return new Date(now.getTime() + amount * unit);
}

function parseOptionalDate(value, key) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, key);
  return d;
}

function parseLocationType(value) {
  if (value === undefined || value === null || value === "") return "neighborhood";
  if (!LOCATION_TYPES.includes(value)) throw httpError(400, "location_type_invalid");
  return value;
}

function assertTimeRange(startTime, endTime) {
  if (startTime && endTime && endTime <= startTime) throw httpError(400, "time_range_invalid");
}

function activeTradeFilter(userId) {
  return { status: "active", $or: [{ requesterId: userId }, { responderId: userId }] };
}

// Writing to each user doc makes concurrent transactions conflict and retry, so counts can't race past the limit
async function assertTradeCapacity(userIds, session, { selfId = null } = {}) {
  const ids = [...new Set(userIds.map(String))].sort();
  await User.updateMany({ _id: { $in: ids } }, { $inc: { tradeLock: 1 } }, { session, timestamps: false });
  for (const id of ids) {
    const count = await Trade.countDocuments(activeTradeFilter(id)).session(session);
    if (count >= MAX_ACTIVE_TRADES) {
      throw httpError(
        409,
        selfId && String(selfId) !== id ? "other_user_active_trade_limit" : "active_trade_limit_reached",
      );
    }
  }
}

function dropExpiredFilter(now = new Date()) {
  return { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] };
}

async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    // The callback may be retried on transient errors, so it must stay idempotent
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function toObjectId(id, notFoundKey) {
  if (!mongoose.Types.ObjectId.isValid(String(id || ""))) throw httpError(404, notFoundKey);
  return new mongoose.Types.ObjectId(String(id));
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundCoord(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.round(n * 1000) / 1000;
}

function publicDropFilter(now = new Date()) {
  return {
    visibility: "public",
    status: "open",
    deletedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  };
}

function textOrEmpty(v, max, key) {
  const s = v === undefined || v === null ? "" : String(v).trim();
  if (s.length > max) throw httpError(400, key);
  return s;
}

function stringArray(v, max, key) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw httpError(400, key);
  return v.map(String);
}

// Status labels are derived on read and never stored
function dropStatusLabel(drop, trade, now = new Date()) {
  if (drop.deletedAt) return "Deleted";
  if (trade?.status === "completed") return "Completed";
  if (trade?.status === "active") return "In progress";
  if (drop.status === "open" && drop.expiresAt && new Date(drop.expiresAt) < now) return "Expired";
  return "Open";
}

function sideOf(trade, userId) {
  if (String(trade.requesterId) === String(userId)) return "requester";
  if (String(trade.responderId) === String(userId)) return "responder";
  return null;
}

function otherParty(trade, userId) {
  return sideOf(trade, userId) === "requester" ? trade.responderId : trade.requesterId;
}

function userBrief(u) {
  if (!u) return null;
  return {
    _id: idStr(u._id),
    name: u.name || "",
    handle: u.handle || "",
    profileIcon: u.profileIcon ? getFullImageUrl(u.profileIcon) : "",
  };
}

async function usersById(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select("name handle profileIcon")
    .lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

function toDropView(drop, viewerId = null, { trade = null } = {}) {
  const isOwner = viewerId && String(viewerId) === String(drop.ownerId);
  const out = {
    _id: idStr(drop._id),
    ownerId: idStr(drop.ownerId),
    ownerHandle: drop.ownerHandle || "",
    kind: drop.kind,
    visibility: drop.visibility,
    type: drop.type || "in_person",
    targetUserId: idStrOrNull(drop.targetUserId),
    needText: drop.needText,
    offerText: drop.offerText,
    title: drop.title || "",
    locationType: drop.locationType || "neighborhood",
    referenceImages: (drop.referenceImages || []).map((m) => getFullImageUrl(m)),
    startTime: drop.startTime || null,
    endTime: drop.endTime || null,
    expiresAt: drop.expiresAt || null,
    needCategoryId: idStr(drop.needCategoryId),
    offerCategoryId: idStr(drop.offerCategoryId),
    timingChip: drop.timingChip?.value ?? idStr(drop.timingChip),
    areaLabel: drop.areaLabel,
    // Other users see ~3 decimal degrees; the owner sees stored precision
    lat: roundCoord(drop.lat),
    lng: roundCoord(drop.lng),
    idea: drop.idea || "",
    status: drop.status,
    statusLabel: dropStatusLabel(drop, trade),
    date: drop.date || null,
    createdAt: drop.createdAt,
    updatedAt: drop.updatedAt,
  };
  if (isOwner) out.yours = true;
  return out;
}

function toTapInView(t) {
  return {
    _id: idStr(t._id),
    dropId: idStr(t.dropId),
    requesterId: idStr(t.requesterId),
    responderId: idStr(t.responderId),
    notes: t.notes || "",
    status: t.status,
    withdrawn: Boolean(t.deletedAt),
    tradeId: idStrOrNull(t.tradeId),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function toTradeView(t) {
  const side = (s) => ({ doneAt: s?.doneAt || null, proof: s?.proof ? getFullImageUrl(s.proof) : "" });
  return {
    _id: idStr(t._id),
    tradeCode: t.tradeCode || null,
    tapInId: idStr(t.tapInId),
    dropId: idStr(t.dropId),
    dropOwnerId: idStr(t.dropOwnerId),
    kind: t.kind,
    requesterId: idStr(t.requesterId),
    responderId: idStr(t.responderId),
    requester: side(t.requester),
    responder: side(t.responder),
    status: t.status,
    disputeId: idStrOrNull(t.disputeId),
    conversationId: idStrOrNull(t.conversationId),
    completedAt: t.completedAt || null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function toDisputeView(d, { includeInternal = false } = {}) {
  const view = {
    _id: idStr(d._id),
    tradeId: idStrOrNull(d.tradeId?._id || d.tradeId),
    raisedBy: idStr(d.raisedBy),
    against: idStr(d.against),
    reason: d.reason,
    priority: d.priority || "medium",
    description: d.description,
    desiredOutcome: d.desiredOutcome || null,
    evidence: d.evidence?.map((m) => getFullImageUrl(m)) || [],
    response: d.response || "",
    responseEvidence: d.responseEvidence?.map((m) => getFullImageUrl(m)) || [],
    respondedAt: d.respondedAt || null,
    status: d.status,
    stage: d.stage || "opened",
    outcome: d.outcome || null,
    resolvedByParticipants: (d.resolvedByParticipants || []).map((item) => ({
      userId: idStr(item.userId),
      confirmedAt: item.confirmedAt || null,
    })),
    reviewRequestedAt: d.reviewRequestedAt || null,
    reviewRequestedBy: idStrOrNull(d.reviewRequestedBy),
    withdrawnAt: d.withdrawnAt || null,
    withdrawnBy: idStrOrNull(d.withdrawnBy),
    escalatedAt: d.escalatedAt || null,
    escalatedBy: idStrOrNull(d.escalatedBy),
    faultUserId: idStrOrNull(d.faultUserId),
    resolvedBy: idStrOrNull(d.resolvedBy),
    resolutionType: d.resolutionType || null,
    resolutionNote: d.resolutionNote || "",
    resolvedAt: d.resolvedAt || null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
  if (includeInternal) view.internalNote = d.internalNote || "";
  return view;
}

async function parseDropContent(body = {}) {
  const { needText, offerText, needCategoryId, offerCategoryId, timingChip, areaLabel, idea, date, lat, lng } = body;

  if (!body.title || !String(body.title).trim()) throw httpError(400, "title_required");
  if (String(body.title).trim().length > 200) throw httpError(400, "title_too_long");
  if (!needText || !String(needText).trim()) throw httpError(400, "need_text_required");
  if (!offerText || !String(offerText).trim()) throw httpError(400, "offer_text_required");
  if (!mongoose.isValidObjectId(needCategoryId) || !mongoose.isValidObjectId(offerCategoryId)) {
    throw httpError(400, "category_required");
  }
  if (!areaLabel || !String(areaLabel).trim()) throw httpError(400, "area_label_required");

  const chip = await TimingChip.findOne({
    value: String(timingChip || "").toLowerCase(),
    status: "active",
  }).lean();
  if (!chip) throw httpError(400, "timing_chip_invalid");

  if (idea && String(idea).length > 1000) throw httpError(400, "idea_too_long");
  if (date && Number.isNaN(new Date(date).getTime())) throw httpError(400, "date_invalid");

  const hasGeo = lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));
  const dropType = body.type === undefined ? "in_person" : String(body.type);
  if (!["in_person", "remote"].includes(dropType)) throw httpError(400, "drop_type_invalid");
  const startTime = parseOptionalDate(body.startTime, "start_time_invalid");
  const endTime = parseOptionalDate(body.endTime, "end_time_invalid");
  assertTimeRange(startTime, endTime);
  return {
    title: String(body.title).trim(),
    locationType: parseLocationType(body.locationType),
    type: dropType,
    referenceImages: stringArray(body.referenceImages, 10, "reference_images_invalid"),
    startTime,
    endTime,
    expiresAt: parseExpiration(body.expiresIn ?? body.expiration),
    needText: String(needText).trim(),
    offerText: String(offerText).trim(),
    needCategoryId: String(needCategoryId),
    offerCategoryId: String(offerCategoryId),
    timingChip: chip._id,
    areaLabel: String(areaLabel).trim(),
    idea: idea ? String(idea) : "",
    date: date ? new Date(date) : null,
    lat: hasGeo ? Number(lat) : null,
    lng: hasGeo ? Number(lng) : null,
    location: hasGeo ? [Number(lng), Number(lat)] : undefined,
  };
}

async function loadOwner(userId) {
  const user = await User.findById(userId).select("handle deletedAt areaLabel lat lng location").lean();
  if (!user || user.deletedAt) throw httpError(401, "account_not_found");
  return user;
}

async function loadTrade(id, session) {
  const tradeId = toObjectId(id, "trade_not_found");
  const q = Trade.findById(tradeId);
  if (session) q.session(session);
  const trade = await q.lean();
  if (!trade) throw httpError(404, "trade_not_found");
  return trade;
}

function requireParty(trade, userId) {
  if (!sideOf(trade, userId)) throw httpError(403, "access_denied");
}

async function reopenDrop(dropId, session) {
  const drop = await Drop.findById(dropId).session(session).lean();
  if (!drop) return;
  if (drop.visibility === "direct") {
    await Drop.updateOne({ _id: dropId, deletedAt: null }, { $set: { deletedAt: new Date() } }, { session });
  } else {
    await Drop.updateOne({ _id: dropId, status: "closed" }, { $set: { status: "open" } }, { session });
  }
}

// Shared by markDone and the admin "complete" outcome
async function completeTradeInSession(filter, session, extraSet = {}) {
  const trade = await Trade.findOneAndUpdate(
    { ...filter, status: "active" },
    { $set: { status: "completed", completedAt: new Date(), ...extraSet } },
    { new: true, session },
  ).lean();
  if (trade) await recordCompletedTrade(trade.requesterId, trade.responderId, { session });
  return trade;
}

async function afterCompletion(trade) {
  await Promise.all([
    createActivity({ type: activityTypes.DROP_COMPLETED, user: trade.dropOwnerId, drop: trade.dropId }).catch(
      () => null,
    ),
    checkAndAwardBadges(trade.requesterId, "completed_trades").catch(() => null),
    checkAndAwardBadges(trade.responderId, "completed_trades").catch(() => null),
  ]);
}

module.exports = {
  withTransaction,
  toObjectId,
  escapeRegex,
  roundCoord,
  publicDropFilter,
  textOrEmpty,
  stringArray,
  dropStatusLabel,
  sideOf,
  otherParty,
  userBrief,
  usersById,
  toDropView,
  toTapInView,
  toTradeView,
  toDisputeView,
  parseDropContent,
  parseExpiration,
  parseOptionalDate,
  parseLocationType,
  assertTimeRange,
  assertTradeCapacity,
  dropExpiredFilter,
  MAX_ACTIVE_TRADES,
  loadOwner,
  loadTrade,
  requireParty,
  reopenDrop,
  completeTradeInSession,
  afterCompletion,
  DISPUTE_WINDOW_DAYS,
  MAX_OPEN_DISPUTES,
  DIRECT_KINDS,
  DISPUTE_REASONS,
  DISPUTE_OUTCOMES,
  DISPUTE_PRIORITIES,
  DISPUTE_STATUSES,
};
