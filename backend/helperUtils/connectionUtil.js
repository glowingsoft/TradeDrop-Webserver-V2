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
  const [user1, user2] = normalizePair(userA, userB);
  return Connection.findOne({ user1, user2 }).lean();
}

async function isActivelyConnected(userA, userB) {
  const connection = await getConnectionBetween(userA, userB);
  return Boolean(connection && connection.status === "active");
}

/**
 * Creates an active connection between two users if one does not already exist.
 * Uses an atomic upsert (backed by the unique user1+user2 index) so concurrent
 * calls for the same pair cannot create duplicate connections.
 */
async function ensureConnection(userA, userB, { tapInId } = {}) {
  const [user1, user2] = normalizePair(userA, userB);
  try {
    return await Connection.findOneAndUpdate(
      { user1, user2 },
      {
        $setOnInsert: {
          user1,
          user2,
          status: "active",
          source: { type: "tapIn", tapInId: tapInId || null },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    // Lost the upsert race — the other request already created the connection.
    if (err && err.code === 11000) {
      return Connection.findOne({ user1, user2 });
    }
    throw err;
  }
}

module.exports = {
  normalizePair,
  isBlockedBetween,
  getConnectionBetween,
  isActivelyConnected,
  ensureConnection,
};
