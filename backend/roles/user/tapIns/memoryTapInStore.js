/**
 * In-memory tap-ins store. Slice 5 mock. No Mongo.
 */

const { randomBytes } = require("crypto");

/** @type {Map<string, object>} */
let tapInsById = new Map();
let tapInReviewsById = new Map();

function createId() {
  return randomBytes(12).toString("hex");
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function resetTapInStore() {
  tapInsById = new Map();
  tapInReviewsById = new Map();
}

function saveTapIn(doc) {
  tapInsById.set(String(doc._id), clone(doc));
  return clone(doc);
}

function findTapInById(id) {
  const t = tapInsById.get(String(id));
  return t ? clone(t) : null;
}

function listTapIns() {
  return Array.from(tapInsById.values()).map(clone);
}

function findPending(applicantId, dropId) {
  return listTapIns().find(
    (t) =>
      String(t.applicantId) === String(applicantId) && String(t.dropId) === String(dropId) && t.status === "pending",
  );
}

function createTapIn(partial) {
  const now = new Date().toISOString();
  const doc = {
    _id: partial._id || createId(),
    dropId: partial.dropId,
    applicantId: partial.applicantId,
    applicantHandle: partial.applicantHandle || "",
    ownerHandle: partial.ownerHandle || "",
    yourOffer: partial.yourOffer,
    availability: partial.availability,
    link: partial.link || "",
    note: partial.note || "",
    media: partial.media || [],
    status: partial.status || "pending",
    ownerJob: partial.ownerJob || { status: "pending", completionImgUrl: "", completedAt: null },
    applicantJob: partial.applicantJob || { status: "pending", completionImgUrl: "", completedAt: null },
    createdAt: now,
    updatedAt: now,
  };
  return saveTapIn(doc);
}

function updateTapIn(id, patch) {
  const existing = tapInsById.get(String(id));
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    _id: existing._id,
    updatedAt: new Date().toISOString(),
  };
  return saveTapIn(next);
}

function declinePendingForDrop(dropId) {
  const declined = [];
  for (const t of listTapIns()) {
    if (String(t.dropId) === String(dropId) && t.status === "pending") {
      declined.push(updateTapIn(t._id, { status: "declined" }));
    }
  }
  return declined;
}

function findReviewByTapInAndFrom(tapInId, fromUserId) {
  return (
    Array.from(tapInReviewsById.values()).find(
      (review) => String(review.tapInId) === String(tapInId) && String(review.fromUserId) === String(fromUserId),
    ) || null
  );
}

function createTapInReview(partial) {
  const now = new Date().toISOString();
  const review = {
    _id: createId(),
    tapInId: partial.tapInId,
    fromUserId: partial.fromUserId,
    toUserId: partial.toUserId,
    fromHandle: partial.fromHandle || "",
    toHandle: partial.toHandle || "",
    stars: partial.stars,
    body: partial.body || "",
    createdAt: now,
    updatedAt: now,
  };
  tapInReviewsById.set(String(review._id), clone(review));
  return clone(review);
}

module.exports = {
  resetTapInStore,
  createId,
  findTapInById,
  listTapIns,
  findPending,
  createTapIn,
  updateTapIn,
  declinePendingForDrop,
  findReviewByTapInAndFrom,
  createTapInReview,
};
