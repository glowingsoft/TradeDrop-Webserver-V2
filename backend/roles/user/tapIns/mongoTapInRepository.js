const TapIn = require("../../../models/TapIn");
const Review = require("../../../models/Review");
const { idStr, idStrOrNull } = require("../_shared/serialize");

function toTapIn(doc) {
  if (!doc) return null;
  return {
    _id: idStr(doc._id),
    dropId: idStr(doc.dropId),
    ownerId: idStr(doc.ownerId),
    applicantId: idStr(doc.applicantId),
    applicantHandle: doc.applicantHandle || "",
    ownerHandle: doc.ownerHandle || "",
    yourOffer: doc.yourOffer,
    availability: doc.availability,
    link: doc.link || "",
    note: doc.note || "",
    media: doc.media || [],
    status: doc.status,
    ownerJob: doc.ownerJob || { status: "pending", completionImgUrl: "", completedAt: null },
    applicantJob: doc.applicantJob || { status: "pending", completionImgUrl: "", completedAt: null },
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
  };
}

async function findById(id) {
  if (!id) return null;
  return toTapIn(await TapIn.findById(id).lean());
}

async function list() {
  const docs = await TapIn.find({}).lean();
  return docs.map(toTapIn);
}

async function findPending(applicantId, dropId) {
  const doc = await TapIn.findOne({
    applicantId,
    dropId,
    status: "pending",
  }).lean();
  return toTapIn(doc);
}

async function create(data) {
  try {
    const doc = await TapIn.create({
      dropId: data.dropId,
      ownerId: data.ownerId,
      applicantId: data.applicantId,
      applicantHandle: data.applicantHandle || "",
      ownerHandle: data.ownerHandle || "",
      yourOffer: data.yourOffer,
      availability: data.availability,
      link: data.link || "",
      note: data.note || "",
      media: data.media || [],
      status: data.status || "pending",
      ownerJob: data.ownerJob,
      applicantJob: data.applicantJob,
    });
    return toTapIn(doc.toObject());
  } catch (err) {
    if (err && err.code === 11000) {
      const e = new Error("tapin_duplicate_pending");
      e.translationKey = "tapin_duplicate_pending";
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function update(id, patch) {
  const doc = await TapIn.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  return toTapIn(doc);
}

async function declinePendingForDrop(dropId) {
  const pending = await TapIn.find({ dropId, status: "pending" }).lean();
  const out = [];
  for (const t of pending) {
    out.push(await update(t._id, { status: "declined" }));
  }
  return out;
}
async function updateMany(filter, patch) {
  const docs = await TapIn.updateMany(filter, { $set: patch }, { new: true });
  return docs;
}
async function reset() {}

async function findReviewByTapInAndFrom(tapInId, fromUserId) {
  return Review.findOne({ tapInId, fromUserId }).lean();
}

async function createTapInReview(data) {
  const review = await Review.create(data);
  return review.toObject();
}

module.exports = {
  reset,
  findById,
  list,
  findPending,
  create,
  update,
  declinePendingForDrop,
  findReviewByTapInAndFrom,
  createTapInReview,
  updateMany,
};
