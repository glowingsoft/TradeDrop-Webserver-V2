/**
 * Idempotent migration: legacy drop/tap-in/job flow -> Drop/TapIn/Trade/Dispute/Connection/Review.
 * Usage: node backend/scripts/migrateTradeFlow.js   (uses MONGO_URI / MONGODB_URI / MONGO_URL)
 * Safe to re-run: every step selects only documents still in the legacy shape.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;

const LEGACY_INDEXES = {
  tapins: ["applicantId_1_dropId_1"],
  connections: ["user1_1_user2_1", "user1_1_status_1", "user2_1_status_1"],
  reviews: ["tapInId_1_fromUserId_1"],
};

const pairKeyOf = (x, y) => [String(x), String(y)].sort().join("_");
const sortedPair = (x, y) => (String(x) < String(y) ? [x, y] : [y, x]);

async function dropLegacyIndexes(db) {
  for (const [coll, names] of Object.entries(LEGACY_INDEXES)) {
    for (const name of names) {
      try {
        await db.collection(coll).dropIndex(name);
      } catch (_) {
        /* already gone */
      }
    }
  }
}

async function upsertConnection(db, a, b, completedIncrement) {
  const [userA, userB] = sortedPair(a, b);
  const now = new Date();
  await db.collection("connections").updateOne(
    { pairKey: pairKeyOf(a, b) },
    {
      $setOnInsert: { userA, userB, source: "trade", status: "active", createdAt: now },
      $set: { updatedAt: now },
      $inc: { completedCount: completedIncrement },
    },
    { upsert: true },
  );
}

async function migrateConnections(db) {
  const col = db.collection("connections");
  const legacy = await col.find({ user1: { $exists: true } }).toArray();
  for (const c of legacy) {
    if (c.status === "removed") {
      await col.deleteOne({ _id: c._id });
      continue;
    }
    const [userA, userB] = sortedPair(c.user1, c.user2);
    const pairKey = pairKeyOf(c.user1, c.user2);
    if (await col.findOne({ pairKey, _id: { $ne: c._id } }, { projection: { _id: 1 } })) {
      await col.deleteOne({ _id: c._id });
      continue;
    }
    await col.updateOne(
      { _id: c._id },
      {
        $set: { pairKey, userA, userB, source: "trade", completedCount: c.completedCount || 0 },
        $unset: { user1: "", user2: "" },
      },
    );
  }
  await col.updateMany({ source: { $type: "object" } }, { $set: { source: "trade" } });
  return legacy.length;
}

// Old Trade docs (ownerId/applicantId) are converted in place to the new shape
async function migrateLegacyTrades(db) {
  const col = db.collection("trades");
  const legacy = await col.find({ applicantId: { $exists: true } }).toArray();
  for (const t of legacy) {
    const done = t.status === "completed";
    const doneAt = t.completedAt || t.updatedAt || new Date();
    await col.updateOne(
      { _id: t._id },
      {
        $set: {
          dropOwnerId: t.ownerId,
          kind: "drop",
          requesterId: t.applicantId,
          responderId: t.ownerId,
          requester: { doneAt: done ? doneAt : null, proof: "" },
          responder: { doneAt: done ? doneAt : null, proof: t.completionPhotoUrl || "" },
          status: done ? "completed" : t.status === "cancelled" ? "cancelled" : "active",
          disputeId: null,
          completedAt: done ? doneAt : null,
        },
        $unset: {
          ownerId: "",
          applicantId: "",
          completionProposedBy: "",
          completionProposedAt: "",
          completionPhotoUrl: "",
        },
      },
    );
    if (done) await upsertConnection(db, t.applicantId, t.ownerId, 1);
  }
  return legacy.length;
}

async function migrateTapIns(db) {
  const tapIns = db.collection("tapins");
  const trades = db.collection("trades");
  const drops = db.collection("drops");

  // 1. Build Trades from legacy job data before the job fields are removed
  const jobbed = await tapIns.find({ status: { $in: ["inprogress", "paused", "completed"] } }).toArray();
  let created = 0;
  for (const t of jobbed) {
    const requesterId = t.requesterId || t.applicantId;
    const responderId = t.responderId || t.ownerId;
    const existing = t.tradeId ? { _id: t.tradeId } : await trades.findOne({ tapInId: t._id }, { projection: { _id: 1 } });
    let tradeId = existing && existing._id;
    if (!tradeId) {
      const drop = await drops.findOne({ _id: t.dropId }, { projection: { ownerId: 1 } });
      const completed = t.status === "completed";
      const reqDone = t.applicantJob?.completedAt || (completed ? t.updatedAt : null) || null;
      const resDone = t.ownerJob?.completedAt || (completed ? t.updatedAt : null) || null;
      const completedAt = completed ? [reqDone, resDone].filter(Boolean).sort((a, b) => b - a)[0] || t.updatedAt : null;
      const now = new Date();
      tradeId = (
        await trades.insertOne({
          tapInId: t._id,
          dropId: t.dropId,
          dropOwnerId: (drop && drop.ownerId) || responderId,
          kind: "drop",
          requesterId,
          responderId,
          requester: { doneAt: reqDone, proof: t.applicantJob?.completionImgUrl || "" },
          responder: { doneAt: resDone, proof: t.ownerJob?.completionImgUrl || "" },
          status: completed ? "completed" : "active",
          disputeId: null,
          completedAt,
          createdAt: t.createdAt || now,
          updatedAt: now,
        })
      ).insertedId;
      created += 1;
      if (completed) await upsertConnection(db, requesterId, responderId, 1);
    }
    await tapIns.updateOne({ _id: t._id }, { $set: { status: "accepted", tradeId } });
  }

  // 2. Renames and removals
  await tapIns.updateMany({ applicantId: { $exists: true } }, [
    { $set: { requesterId: "$applicantId", responderId: "$ownerId" } },
    { $unset: ["applicantId", "ownerId"] },
  ]);
  await tapIns.updateMany(
    {},
    { $unset: { type: "", ownerJob: "", applicantJob: "", ownerHandle: "", applicantHandle: "" } },
  );

  // 3. withdrawn / deleted become pending requests marked with deletedAt
  const gone = await tapIns.updateMany({ status: { $in: ["withdrawn", "deleted"] } }, [
    { $set: { status: "pending", deletedAt: { $ifNull: ["$deletedAt", "$updatedAt"] } } },
  ]);
  await tapIns.updateMany({ deletedAt: { $exists: false } }, { $set: { deletedAt: null } });
  return { tradesCreated: created, withdrawnOrDeleted: gone.modifiedCount };
}

async function migrateDrops(db) {
  const drops = db.collection("drops");
  await drops.updateMany({ status: "deleted" }, [
    { $set: { deletedAt: { $ifNull: ["$deletedAt", "$updatedAt"] }, status: "closed" } },
  ]);
  await drops.updateMany({ status: { $in: ["active", "expired"] } }, { $set: { status: "open" } });
  await drops.updateMany({ status: { $in: ["inprogress", "paused", "completed"] } }, { $set: { status: "closed" } });
  await drops.updateMany({ type: { $exists: true } }, { $unset: { type: "" } });
  await drops.updateMany({ kind: { $exists: false } }, { $set: { kind: "drop" } });
  await drops.updateMany({ visibility: { $exists: false } }, { $set: { visibility: "public" } });
  await drops.updateMany({ deletedAt: { $exists: false } }, { $set: { deletedAt: null } });
}

async function migrateReviews(db) {
  const reviews = db.collection("reviews");
  const tapIns = db.collection("tapins");
  const legacy = await reviews.find({ fromUserId: { $exists: true } }).toArray();
  let moved = 0;
  for (const r of legacy) {
    const tapIn = r.tapInId ? await tapIns.findOne({ _id: r.tapInId }, { projection: { tradeId: 1 } }) : null;
    if (!tapIn || !tapIn.tradeId) {
      // No trade to attach to; keep the review aside instead of losing it
      moved += 1;
      await db.collection("reviews_legacy").updateOne({ _id: r._id }, { $setOnInsert: r }, { upsert: true });
      await reviews.deleteOne({ _id: r._id });
      continue;
    }
    await reviews.updateOne(
      { _id: r._id },
      {
        $set: {
          tradeId: tapIn.tradeId,
          reviewerId: r.fromUserId,
          revieweeId: r.toUserId,
          rating: r.stars,
          comment: r.body || "",
        },
        $unset: {
          tapInId: "",
          fromUserId: "",
          toUserId: "",
          stars: "",
          body: "",
          fromHandle: "",
          toHandle: "",
          fromUserDeleted: "",
          toUserDeleted: "",
        },
      },
    );
  }
  return { migrated: legacy.length - moved, movedToLegacy: moved };
}

// Old dispute shape (drop/tapIn/reportedBy) has no Trade to attach to; keep it aside untouched
async function migrateDisputes(db) {
  const disputes = db.collection("disputes");
  const legacy = await disputes.find({ tradeId: { $exists: false } }).toArray();
  for (const d of legacy) {
    await db.collection("disputes_legacy").updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true });
    await disputes.deleteOne({ _id: d._id });
  }
  return legacy.length;
}

async function syncModelIndexes() {
  for (const n of ["Drop", "TapIn", "Trade", "Dispute", "Connection", "Review"]) {
    require(`../models/${n}`);
    await mongoose.model(n).syncIndexes();
  }
}

async function run() {
  if (!uri) throw new Error("Set MONGO_URI (or MONGODB_URI / MONGO_URL)");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const report = {};
  await dropLegacyIndexes(db);
  report.connections = await migrateConnections(db);
  report.legacyTrades = await migrateLegacyTrades(db);
  report.tapIns = await migrateTapIns(db);
  await migrateDrops(db);
  report.reviews = await migrateReviews(db);
  report.legacyDisputesMoved = await migrateDisputes(db);
  await syncModelIndexes();
  console.log("Migration complete", JSON.stringify(report));
}

if (require.main === module) {
  run()
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error("Migration failed:", err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run };
