const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const repo = require("../../backend/roles/user/auth/authRepository");
const { Drop } = require("../../backend/models/Drop");
const BlockedUser = require("../../backend/models/BlockedUser");
const Connection = require("../../backend/models/Connection");
const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const { Favorites } = require("../../backend/commonModules/favorites/Favorite");
const { Badge } = require("../../backend/models/Badge");
const badgesService = require("../../backend/roles/admin/badges/badgesService");
const service = require("../../backend/roles/user/me/profileService");

describe("self profile summary", () => {
  const userId = new mongoose.Types.ObjectId();
  const circleIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const original = {};
  let queries;
  let baseUrl;

  before(() => {
    original.findById = repo.findById;
    original.dropFind = Drop.find;
    original.circleMemberDistinct = CircleMember.distinct;
    original.circleCount = Circle.countDocuments;
    original.connectionCount = Connection.countDocuments;
    original.connectionAggregate = Connection.aggregate;
    original.favoriteCount = Favorites.countDocuments;
    original.blockedUserCount = BlockedUser.countDocuments;
    original.badgeFind = Badge.find;
    original.listUserBadges = badgesService.listUserBadges;
    baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
  });

  beforeEach(() => {
    queries = {};
    queries.connectionProfiles = [
      { _id: new mongoose.Types.ObjectId(), name: "Peer", profileIcon: "peer.png" },
      { _id: new mongoose.Types.ObjectId(), name: "Remote", profileIcon: "https://cdn.example.com/peer.png" },
    ];
    repo.findById = async () => ({ _id: String(userId), name: "Me" });
    Drop.find = (filter) => {
      queries.dropFilter = filter;
      return { select: () => ({ lean: async () => [] }) };
    };
    CircleMember.distinct = async (field, filter) => {
      queries.organizerFilter = { field, filter };
      return circleIds;
    };
    Circle.countDocuments = async (filter) => {
      queries.circleCountFilter = filter;
      return 2;
    };
    Connection.countDocuments = async (filter) => {
      queries.connectionCountFilter = filter;
      return 6;
    };
    Favorites.countDocuments = async (filter) => {
      queries.favoriteCountFilter = filter;
      return 8;
    };
    BlockedUser.countDocuments = async (filter) => {
      queries.blockedUserCountFilter = filter;
      return 2;
    };
    Connection.aggregate = async (pipeline) => {
      queries.connectionPipeline = pipeline;
      return queries.connectionProfiles;
    };
    Badge.find = () => ({ distinct: async () => [] });
    badgesService.listUserBadges = async () => [];
  });

  afterEach(() => {
    repo.findById = original.findById;
    Drop.find = original.dropFind;
    CircleMember.distinct = original.circleMemberDistinct;
    Circle.countDocuments = original.circleCount;
    Connection.countDocuments = original.connectionCount;
    Connection.aggregate = original.connectionAggregate;
    Favorites.countDocuments = original.favoriteCount;
    BlockedUser.countDocuments = original.blockedUserCount;
    Badge.find = original.badgeFind;
    badgesService.listUserBadges = original.listUserBadges;
  });

  after(() => {
    if (baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = baseUrl;
  });

  it("returns organizer circle count and total plus four latest connection profiles", async () => {
    const profile = await service.getMe(userId);

    assert.equal(profile.organizerCircleCount, 2);
    assert.equal(profile.connectionCount, 6);
    assert.equal(profile.savedUserCount, 8);
    assert.equal(profile.blockedUserCount, 2);
    assert.deepEqual(profile.latestConnections, [
      {
        _id: String(queries.connectionProfiles[0]._id),
        name: "Peer",
        profileIcon: "https://images.example.com/peer.png",
      },
      {
        _id: String(queries.connectionProfiles[1]._id),
        name: "Remote",
        profileIcon: "https://cdn.example.com/peer.png",
      },
    ]);
    assert.deepEqual(queries.organizerFilter, {
      field: "circleId",
      filter: { userId, status: "active", role: "organizer" },
    });
    assert.deepEqual(queries.circleCountFilter, { _id: { $in: circleIds }, deletedAt: null });
    assert.deepEqual(queries.favoriteCountFilter, { user: String(userId) });
    assert.deepEqual(queries.blockedUserCountFilter, { blockedBy: String(userId) });
    assert.equal(queries.connectionCountFilter.status, "active");
    assert.deepEqual(queries.connectionPipeline[0], {
      $match: { status: "active", $or: [{ userA: userId }, { userB: userId }] },
    });
    assert.deepEqual(queries.connectionPipeline.at(-2), { $limit: 4 });
  });
});
