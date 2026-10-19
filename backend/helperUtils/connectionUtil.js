const Connection = require("../models/Connection");
const BlockedUser = require("../models/BlockedUser");

function normalizePair(userA, userB) {
  return Connection.normalizePair(userA, userB);
}

/** True when either user has blocked the other. */
async function isBlockedBetween(userA, userB) {
  const blocked = await BlockedUser.findOne({
    $or: [
      { blockedBy: userA, blockedUser: userB },
      { blockedBy: userB, blockedUser: userA },
    ],
  }).lean();
  return Boolean(blocked);
}

async function getConnectionBetween(userA, userB) {
  return Connection.findOne({ pairKey: Connection.pairKeyFor(userA, userB) }).lean();
}

async function isActivelyConnected(userA, userB) {
  const connection = await getConnectionBetween(userA, userB);
  return Boolean(connection && connection.status === "active");
}

/**
 * Records a completed trade between two users: creates the active connection on
 * first completion and bumps completedCount. Atomic upsert backed by the unique
 * pairKey index, so concurrent calls for the same pair cannot create duplicates.
 */
async function recordCompletedTrade(userA, userB, { session } = {}) {
  const [a, b] = normalizePair(userA, userB);
  const pairKey = `${a}_${b}`;
  const run = () =>
    Connection.findOneAndUpdate(
      { pairKey },
      {
        $setOnInsert: { pairKey, userA: a, userB: b, status: "active", source: "trade" },
        $inc: { completedCount: 1 },
      },
      { new: true, upsert: true, session },
    );
  try {
    return await run();
  } catch (err) {
    // Lost the upsert race; the document now exists, so the update path applies.
    if (err && err.code === 11000 && !session) return run();
    throw err;
  }
}

module.exports = {
  normalizePair,
  isBlockedBetween,
  getConnectionBetween,
  isActivelyConnected,
  recordCompletedTrade,
};
