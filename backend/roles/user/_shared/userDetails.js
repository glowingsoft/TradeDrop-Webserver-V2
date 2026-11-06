const mongoose = require("mongoose");
const { User } = require("@UsersModel");
const Connection = require("@models/Connection");
const BlockedUser = require("@models/BlockedUser");
const Trade = require("@models/Trade");
const Circle = require("@models/Circle");
const { lookupUserCrafts, lookupUserRating } = require("@helperUtils/dbUtils/queryUtil");
const { getConnectionStatus, isBlockedBetween } = require("@helperUtils/connectionUtil");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const { portfolioItemView } = require("@helperUtils/portfolioUtil");
const { roundCoord } = require("./tradeShared");
const { httpError } = require("./serialize");

async function latestConnectionsFor(userId, viewerId) {
  const viewer = new mongoose.Types.ObjectId(String(viewerId));
  const connections = await Connection.aggregate([
    { $match: { status: "active", $or: [{ userA: userId }, { userB: userId }] } },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $set: { peerId: { $cond: [{ $eq: ["$userA", userId] }, "$userB", "$userA"] } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "peerId",
        foreignField: "_id",
        as: "peer",
      },
    },
    { $unwind: "$peer" },
    {
      $match: {
        "peer.deletedAt": null,
        "peer.accountState.status": "active",
        $or: [
          { peerId: viewer },
          {
            "peer.accountState.userType": "user",
            "peer.verificationStatus.email": "verified",
            "peer.onboarding": true,
            "peer.radarVisible": { $ne: false },
            "peer.openToTrade": { $ne: false },
            "peer.hideFromSearch": { $ne: true },
          },
        ],
      },
    },
    {
      $lookup: {
        from: BlockedUser.collection.name,
        let: { peerId: "$peerId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $and: [{ $eq: ["$blockedBy", viewer] }, { $eq: ["$blockedUser", "$$peerId"] }] },
                  { $and: [{ $eq: ["$blockedBy", "$$peerId"] }, { $eq: ["$blockedUser", viewer] }] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "blocks",
      },
    },
    { $match: { "blocks.0": { $exists: false } } },
    { $limit: 2 },
    { $project: { _id: "$peer._id", name: "$peer.name", handle: "$peer.handle", profileIcon: "$peer.profileIcon" } },
  ]);
  return connections.map((user) => ({
    ...user,
    profileIcon: user.profileIcon ? getFullImageUrl(user.profileIcon) : "",
  }));
}

async function getUserDetails(viewerId, targetId) {
  if (!viewerId) throw httpError(401, "unauthorized");
  if (!mongoose.isValidObjectId(targetId) || String(viewerId) === String(targetId)) {
    throw httpError(404, "user_not_found");
  }
  const userId = new mongoose.Types.ObjectId(targetId);
  const [blocked, users] = await Promise.all([
    isBlockedBetween(viewerId, userId),
    User.aggregate([
      {
        $match: {
          _id: userId,
          deletedAt: null,
          "accountState.userType": "user",
          "accountState.status": "active",
          "verificationStatus.email": "verified",
          onboarding: true,
          radarVisible: { $ne: false },
          openToTrade: { $ne: false },
          hideFromSearch: { $ne: true },
        },
      },
      lookupUserCrafts(),
      ...lookupUserRating(),
      {
        $project: {
          name: 1, handle: 1, profileIcon: 1, coverImage: 1, bio: 1, specialty: 1,
          areaLabel: 1, lat: 1, lng: 1, openToTrade: 1, crafts: 1, links: 1,
          portfolioItems: 1, verified: 1, averageRating: 1, reviewCount: 1,
        },
      },
    ]),
  ]);
  if (blocked || !users.length) throw httpError(404, "user_not_found");

  const [relationship, connectionCount, latestConnections, collaborations, mutualCollaborationCount, circles] = await Promise.all([
    getConnectionStatus(viewerId, userId),
    Connection.countDocuments({ status: "active", $or: [{ userA: userId }, { userB: userId }] }),
    latestConnectionsFor(userId, viewerId),
    Trade.find({
      kind: "collaboration",
      status: "completed",
      $or: [{ requesterId: userId }, { responderId: userId }],
    })
      .select("_id kind status completedAt createdAt")
      .sort({ completedAt: -1, _id: -1 })
      .limit(2)
      .lean(),
    Trade.countDocuments({
      kind: "collaboration",
      status: { $in: ["active", "completed"] },
      $or: [
        { requesterId: viewerId, responderId: userId },
        { requesterId: userId, responderId: viewerId },
      ],
    }),
    Circle.find({ creatorId: userId, deletedAt: null })
      .select("_id name purpose category coverImage city privacy status createdAt updatedAt")
      .sort({ updatedAt: -1, _id: -1 })
      .limit(2)
      .lean(),
  ]);
  const user = users[0];
  return {
    ...user,
    profileIcon: user.profileIcon ? getFullImageUrl(user.profileIcon) : "",
    coverImage: user.coverImage ? getFullImageUrl(user.coverImage) : "",
    lat: roundCoord(user.lat),
    lng: roundCoord(user.lng),
    portfolioItems: (user.portfolioItems || []).map((item) => portfolioItemView(item, { fullUrls: true })),
    ...relationship,
    connectionCount,
    latestConnections,
    mutualCollaborationCount,
    latestCollaborations: collaborations,
    latestCircles: circles.map((circle) => ({
      ...circle,
      coverImage: circle.coverImage ? getFullImageUrl(circle.coverImage) : "",
    })),
  };
}

module.exports = { getUserDetails };
