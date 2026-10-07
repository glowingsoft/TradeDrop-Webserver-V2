const repo = require("./tapInRepository");
const mongoose = require("mongoose");
const dropRepo = require("../drops/dropRepository");
const authRepo = require("../auth/authRepository");
const { generateMeta, parsePaginationParams } = require("@helperUtils/responseUtil");
const TapIn = require("@models/TapIn");
const Category = require("@models/Category");
const timingChipRepo = require("../catalog/timingChipRepository");
const { createActivity, activityTypes } = require("@helperUtils/activityUtil");
const { checkAndAwardBadges } = require("@backend/roles/admin/badges/badgeEngine");
const Review = require("@models/Review");
const { ensureConnection } = require("@helperUtils/connectionUtil");

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

function toPublic(tapIn) {
  return {
    _id: tapIn._id,
    dropId: tapIn.dropId,
    applicantId: tapIn.applicantId,
    applicantHandle: tapIn.applicantHandle || "",
    ownerHandle: tapIn.ownerHandle || "",
    yourOffer: tapIn.yourOffer,
    availability: tapIn.availability,
    link: tapIn.link || "",
    note: tapIn.note || "",
    media: tapIn.media || [],
    status: tapIn.status,
    ownerJob: tapIn.ownerJob || { status: "pending", completionImgUrl: "", completedAt: null },
    applicantJob: tapIn.applicantJob || { status: "pending", completionImgUrl: "", completedAt: null },
    createdAt: tapIn.createdAt,
    updatedAt: tapIn.updatedAt,
  };
}

async function getActiveDropOrThrow(dropId) {
  const drop = await dropRepo.findById(dropId);
  if (!drop || drop.status === "deleted" || drop.deletedAt) {
    throw AppError("drop_not_found", 404);
  }
  if (drop.status !== "active") {
    throw AppError("drop_not_accepting_tapins", 403);
  }
  return drop;
}

async function createTapIn(userId, dropId, body = {}) {
  // Auth + verified/onboarded enforced by route middleware
  const user = await requireUser(userId);
  const drop = await getActiveDropOrThrow(dropId);

  if (!body.recipientId && String(drop.ownerId) === String(userId)) {
    throw AppError("tapin_own_drop_forbidden", 403);
  }

  const { yourOffer, availability, link, note, media } = body;
  if (!yourOffer || !String(yourOffer).trim()) {
    throw AppError("your_offer_required", 400);
  }
  if (!availability || !String(availability).trim()) {
    throw AppError("availability_required", 400);
  }
  if (note && String(note).length > 280) {
    throw AppError("note_too_long", 400);
  }
  if (media && (!Array.isArray(media) || media.length > 6)) {
    throw AppError("media_max", 400);
  }

  if (await repo.findPending(userId, dropId)) {
    throw AppError("tapin_duplicate_pending", 409);
  }
  const ownerId = drop.type === "need" ? drop.ownerId : body.recipientId;
  const tapIn = await repo.create({
    dropId: drop._id,
    applicantId: user._id,
    applicantHandle: user.handle || "",
    ownerId: ownerId,
    ownerHandle: (await requireUser(ownerId)).handle || "",
    yourOffer: String(yourOffer).trim(),
    availability: String(availability).trim(),
    link: link ? String(link) : "",
    note: note ? String(note) : "",
    media: Array.isArray(media) ? media.map(String) : [],
    status: "pending",
  });

  return toPublic(tapIn);
}

async function listMyTapIns(userId, { direction = "outgoing", cursor, limit } = {}) {
  const dir = String(direction || "outgoing").toLowerCase();
  if (dir !== "incoming" && dir !== "outgoing") {
    throw AppError("invalid_direction", 400);
  }

  let lim = parseInt(limit, 10);
  if (Number.isNaN(lim) || lim < 1) lim = dropRepo.DEFAULT_LIST_LIMIT || 20;
  const maxLim = dropRepo.MAX_LIST_LIMIT || 50;
  if (lim > maxLim) lim = maxLim;

  const all = await repo.list();
  let items;
  if (dir === "outgoing") {
    items = all.filter((t) => String(t.applicantId) === String(userId));
  } else {
    const myDropIds = new Set(
      (await dropRepo.listAll()).filter((d) => String(d.ownerId) === String(userId)).map((d) => String(d._id)),
    );
    items = all.filter((t) => myDropIds.has(String(t.dropId)));
  }

  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  if (cursor) {
    try {
      const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
      const [createdAt, id] = raw.split("|");
      if (createdAt && id) {
        items = items.filter((t) => {
          if (String(t.createdAt) < createdAt) return true;
          if (String(t.createdAt) > createdAt) return false;
          return String(t._id) < String(id);
        });
      }
    } catch (_) {
      // ignore bad cursor
    }
  }

  const page = items.slice(0, lim);
  const last = page[page.length - 1];
  const nextCursor =
    page.length === lim && last ? Buffer.from(`${last.createdAt}|${last._id}`, "utf8").toString("base64url") : null;

  return {
    data: page.map(toPublic),
    meta: { nextCursor, limit: lim },
  };
}

async function requireTapIn(id) {
  const tapIn = await repo.findById(id);
  if (!tapIn) throw AppError("tapin_not_found", 404);
  return tapIn;
}

async function acceptTapIn(userId, tapInId) {
  const tapIn = await requireTapIn(tapInId);
  if (tapIn.status !== "pending") {
    throw AppError("tapin_not_pending", 409);
  }

  const drop = await dropRepo.findById(tapIn.dropId);
  if (!drop || drop.status !== "active" || drop.deletedAt) {
    throw AppError("drop_not_found", 404);
  }
  if (String(tapIn.ownerId) !== String(userId)) {
    throw AppError("access_denied", 403);
  }

  const updated = await repo.update(tapIn._id, {
    status: "inprogress",
    ownerHandle: tapIn.ownerHandle || drop.ownerHandle || "",
    ownerJob: { status: "inprogress", completionImgUrl: "", completedAt: null },
    applicantJob: { status: "inprogress", completionImgUrl: "", completedAt: null },
  });
  await repo.updateMany({ dropId: drop._id, _id: { $ne: tapIn._id }, status: "pending" }, { status: "declined" });
  await dropRepo.update(drop._id, {
    status: "inprogress",
  });

  // TapIn reaching inprogress for the first time creates a Connection between owner and applicant.
  try {
    await ensureConnection(tapIn.ownerId, tapIn.applicantId, { tapInId: tapIn._id });
  } catch (err) {
    console.error("[ensureConnection] failed for tapIn accept:", err);
  }

  return { tapIn: toPublic(updated) };
}

async function declineTapIn(userId, tapInId) {
  const tapIn = await requireTapIn(tapInId);
  if (tapIn.status !== "pending") {
    throw AppError("tapin_not_pending", 409);
  }

  const drop = await dropRepo.findById(tapIn.dropId);
  if (!drop || drop.status === "deleted" || drop.deletedAt) {
    throw AppError("drop_not_found", 404);
  }
  if (String(tapIn.ownerId) !== String(userId)) {
    throw AppError("access_denied", 403);
  }

  const updated = await repo.update(tapIn._id, { status: "declined" });
  if (drop.type === "offer") {
    await dropRepo.remove(drop._id);
  }
  return { tapIn: toPublic(updated) };
}

async function withdrawTapIn(userId, tapInId) {
  const tapIn = await requireTapIn(tapInId);
  if (String(tapIn.applicantId) !== String(userId)) {
    throw AppError("access_denied", 403);
  }
  if (tapIn.status !== "pending") {
    throw AppError("tapin_not_pending", 409);
  }
  const updated = await repo.update(tapIn._id, { status: "withdrawn" });
  await dropRepo.update(tapIn.dropId, { status: "active" });
  await repo.updateMany({ dropId: tapIn.dropId, status: "declined" }, { status: "pending" });
  return { tapIn: toPublic(updated) };
}

function emptyJob() {
  return { status: "pending", completionImgUrl: "", completedAt: null };
}

async function requireJobParticipant(userId, tapInId) {
  const tapIn = await requireTapIn(tapInId);
  const drop = await dropRepo.findById(tapIn.dropId);
  if (!drop || drop.status === "deleted" || drop.deletedAt) {
    throw AppError("drop_not_found", 404);
  }

  if (String(drop.ownerId) === String(userId)) {
    return { tapIn, role: "owner", otherRole: "applicant" };
  }
  if (String(tapIn.applicantId) === String(userId)) {
    return { tapIn, role: "applicant", otherRole: "owner" };
  }
  throw AppError("access_denied", 403);
}

function readJob(tapIn, role) {
  return tapIn[`${role}Job`] || emptyJob();
}

/** A participant asks the other participant to confirm that their own job is done. */
async function requestJobCompletion(userId, tapInId, body = {}) {
  const { tapIn, role } = await requireJobParticipant(userId, tapInId);
  if (tapIn.status !== "accepted" && tapIn.status !== "inprogress") {
    throw AppError("tapin_not_in_progress", 409);
  }

  const job = readJob(tapIn, role);
  if (job.status !== "inprogress") throw AppError("job_not_in_progress", 409);

  const image = body.completionImgUrl || body.photoUrl || body.imageUrl || "";
  const updated = await repo.update(tapIn._id, {
    [`${role}Job`]: {
      ...job,
      status: "completion_requested",
      completionImgUrl: image ? String(image) : "",
    },
    status: "inprogress",
  });
  return { tapIn: toPublic(updated) };
}

/** Only the other participant can approve a completion request. */
async function confirmJobCompletion(userId, tapInId) {
  const { tapIn, role, otherRole } = await requireJobParticipant(userId, tapInId);
  if (tapIn.status !== "accepted" && tapIn.status !== "inprogress") {
    throw AppError("tapin_not_in_progress", 409);
  }

  const otherJob = readJob(tapIn, otherRole);
  if (otherJob.status !== "completion_requested") {
    throw AppError("job_not_completion_requested", 409);
  }

  const completedJob = {
    ...otherJob,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  const ownJob = readJob(tapIn, role);
  const bothCompleted = ownJob.status === "completed";
  const updated = await repo.update(tapIn._id, {
    [`${otherRole}Job`]: completedJob,
    ...(bothCompleted ? { status: "completed" } : {}),
  });
  if (bothCompleted) {
    Promise.all([
      dropRepo.update(tapIn.dropId, { status: bothCompleted ? "completed" : "inprogress" }),
      createActivity({
        type: activityTypes.DROP_COMPLETED,
        user: tapIn.dropId,
      }),
      checkAndAwardBadges(tapIn.ownerId, "completed_trades"),
      checkAndAwardBadges(tapIn.applicantId, "completed_trades"),
    ]).catch((err) => console.error("[checkAndAwardBadges] failed:", err));
  }
  return { tapIn: toPublic(updated), reviewsEnabled: bothCompleted };
}

async function createTapInReview(userId, tapInId, body = {}) {
  const user = await requireUser(userId);
  const { tapIn, role } = await requireJobParticipant(userId, tapInId);
  if (readJob(tapIn, role === "owner" ? "applicant" : "owner").status !== "completed") {
    throw AppError("review_not_allowed", 403);
  }

  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw AppError("stars_required", 400);
  const reviewBody = body.body == null ? "" : String(body.body);
  if (reviewBody.length > 400) throw AppError("review_body_too_long", 400);
  if (await repo.findReviewByTapInAndFrom(tapIn._id, userId)) throw AppError("review_duplicate", 409);

  const recipientId = role === "owner" ? tapIn.applicantId : (await dropRepo.findById(tapIn.dropId)).ownerId;
  const recipient = await authRepo.findById(recipientId);
  const review = await repo.createTapInReview({
    tapInId: tapIn._id,
    fromUserId: user._id,
    toUserId: recipientId,
    fromHandle: user.handle || "",
    toHandle: recipient?.handle || "",
    stars,
    body: reviewBody,
  });
  return {
    _id: review._id,
    tapInId: review.tapInId,
    fromUserId: review.fromUserId,
    toUserId: review.toUserId,
    stars: review.stars,
    body: review.body,
    createdAt: review.createdAt,
  };
}

async function getAllTapInReviews({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, tapInId, fromUserId, toUserId, stars } = req.query;
  const match = { ...filter };

  if (tapInId && mongoose.Types.ObjectId.isValid(tapInId)) {
    match.tapInId = new mongoose.Types.ObjectId(tapInId);
  }
  if (fromUserId && mongoose.Types.ObjectId.isValid(fromUserId)) {
    match.fromUserId = new mongoose.Types.ObjectId(fromUserId);
  }
  if (toUserId && mongoose.Types.ObjectId.isValid(toUserId)) {
    match.toUserId = new mongoose.Types.ObjectId(toUserId);
  }
  if (stars && Number.isInteger(Number(stars)) && Number(stars) >= 1 && Number(stars) <= 5) {
    match.stars = Number(stars);
  }

  const searchValue = String(keyword || "").trim();
  if (searchValue) {
    const regex = { $regex: searchValue, $options: "i" };
    match.$or = [{ body: regex }, { fromHandle: regex }, { toHandle: regex }];
  }
  const [result] = await Review.aggregate([
    { $match: match },
    {
      $facet: {
        reviews: [
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $lookup: {
              from: "users",
              localField: "fromUserId",
              foreignField: "_id",
              pipeline: [{ $project: { _id: 1, name: 1, handle: 1, profileIcon: 1 } }],
              as: "fromUser",
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "toUserId",
              foreignField: "_id",
              pipeline: [{ $project: { _id: 1, name: 1, handle: 1, profileIcon: 1 } }],
              as: "toUser",
            },
          },
          { $set: { fromUser: { $first: "$fromUser" }, toUser: { $first: "$toUser" } } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;
  return {
    data: result?.reviews || [],
    meta: generateMeta(page, limit, total),
  };
}

async function getAllTapIns({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);

  const { keyword, status, dropId, applicantId, applicantHandle, ownerId, timingChip } = req.query;

  // Common filters - status intentionally excluded
  const baseMatch = {
    ...filter,
    status: { $ne: "deleted" },
  };

  if (ownerId) {
    baseMatch.ownerId = new mongoose.Types.ObjectId(ownerId);
  }

  if (dropId) {
    baseMatch.dropId = new mongoose.Types.ObjectId(dropId);
  }

  if (applicantId) {
    baseMatch.applicantId = new mongoose.Types.ObjectId(applicantId);
  }

  if (applicantHandle?.trim()) {
    baseMatch.applicantHandle = {
      $regex: applicantHandle.trim(),
      $options: "i",
    };
  }

  if (keyword?.trim()) {
    const regex = {
      $regex: keyword.trim(),
      $options: "i",
    };

    baseMatch.$or = [
      { applicantHandle: regex },
      { yourOffer: regex },
      { availability: regex },
      { link: regex },
      { note: regex },
    ];
  }

  let timingChipId = timingChip;
  if (typeof timingChip === "string" && timingChip.trim()) {
    const timingChipValue = timingChip.trim();
    if (mongoose.Types.ObjectId.isValid(timingChipValue)) {
      timingChipId = new mongoose.Types.ObjectId(timingChipValue);
    } else {
      const timingChipDoc = await timingChipRepo.findByValue(timingChipValue);
      if (timingChipDoc?._id && mongoose.Types.ObjectId.isValid(timingChipDoc._id)) {
        timingChipId = new mongoose.Types.ObjectId(timingChipDoc._id);
      }
    }
  }

  const timingChipMatch = timingChip
    ? [{ $match: { "drop.timingChip": timingChipId } }]
    : [];
  const statusMatch = status ? [{ $match: { status } }] : [];

  const [result] = await TapIn.aggregate([
    // Match common filters first
    { $match: baseMatch },

    // Get Drop before timingChip filter/pagination
    {
      $lookup: {
        from: "drops",
        localField: "dropId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              _id: 1,
              ownerId: 1,
              ownerHandle: 1,
              needText: 1,
              offerText: 1,
              needCategoryId: 1,
              offerCategoryId: 1,
              timingChip: 1,
              date: 1,
              areaLabel: 1,
            },
          },
        ],
        as: "drop",
      },
    },

    {
      $set: {
        drop: { $first: "$drop" },
      },
    },
    {
      $facet: {
        tapIns: [
          ...statusMatch,
          ...timingChipMatch,
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },

          {
            $lookup: {
              from: "users",
              localField: "applicantId",
              foreignField: "_id",
              pipeline: [
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    profileIcon: {
                      $concat: [process.env.S3_BASE_URL || "", "$profileIcon"],
                    },
                  },
                },
              ],
              as: "applicant",
            },
          },

          {
            $lookup: {
              from: "users",
              localField: "ownerId",
              foreignField: "_id",
              pipeline: [
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    profileIcon: {
                      $concat: [process.env.S3_BASE_URL || "", "$profileIcon"],
                    },
                  },
                },
              ],
              as: "owner",
            },
          },

          {
            $set: {
              applicant: { $first: "$applicant" },
              owner: { $first: "$owner" },
            },
          },

          {
            $project: {
              _id: 1,
              dropId: 1,
              applicantId: 1,
              applicantHandle: 1,
              ownerHandle: 1,
              ownerId: 1,
              applicant: 1,
              owner: 1,
              yourOffer: 1,
              availability: 1,
              link: 1,
              note: 1,
              media: 1,
              status: 1,
              ownerJob: 1,
              applicantJob: 1,
              deletedAt: 1,
              drop: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],

        // Total respects selected status + timingChip
        total: [...statusMatch, ...timingChipMatch, { $count: "count" }],

        // Counts respect timingChip but ignore selected status
        counts: [
          ...timingChipMatch,
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;

  const tapInsCount = {
    pending: 0,
    accepted: 0,
    declined: 0,
    withdrawn: 0,
    deleted: 0,
  };

  (result?.counts || []).forEach(({ _id, count }) => {
    tapInsCount[_id] = count;
  });

  const meta = generateMeta(page, limit, total);

  const categories = await Category.find({}, { _id: 1, name: 1 }).lean();

  meta.timingChips = [{ value: null, label: "All" }, ...(await timingChipRepo.find({}))];

  meta.categories = [{ _id: null, name: "All" }, ...categories];

  meta.counts = tapInsCount;

  return {
    data: result?.tapIns || [],
    meta,
  };
}

module.exports = {
  createTapIn,
  listMyTapIns,
  acceptTapIn,
  declineTapIn,
  withdrawTapIn,
  requestJobCompletion,
  confirmJobCompletion,
  createTapInReview,
  getAllTapInReviews,
  getAllTapIns,
  AppError,
};
