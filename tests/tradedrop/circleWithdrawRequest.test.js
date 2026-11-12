const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const CirclePollVote = require("../../backend/models/CirclePollVote");
const Category = require("../../backend/models/Category");
const Event = require("../../backend/models/Event");
const { Drop } = require("../../backend/models/Drop");
const { User } = require("../../backend/models/UserModel");
const membership = require("../../backend/roles/user/circles/membership");
const service = require("../../backend/roles/user/circles/service");

describe("circle membership request withdrawal", () => {
  const userId = new mongoose.Types.ObjectId();
  const circleId = new mongoose.Types.ObjectId();
  const originals = [];

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }

  function query(items) {
    const result = {
      sort: () => result,
      limit: () => result,
      select: () => result,
      lean: async () => items,
    };
    return result;
  }

  before(() => {
    replace(mongoose, "startSession", async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    }));
    replace(Circle, "findOne", (filter) => {
      assert.equal(String(filter._id), String(circleId));
      const circle = {
        _id: circleId,
        creatorId: userId,
        name: "Circle",
        purpose: "Purpose",
        category: new mongoose.Types.ObjectId(),
        privacy: "approval",
      };
      const query = {
        session: () => query,
        then: (resolve, reject) => Promise.resolve(circle).then(resolve, reject),
      };
      return query;
    });
    replace(CircleMember, "findOneAndUpdate", async (filter, update) => {
      assert.deepEqual(filter, { circleId, userId, status: "pending" });
      assert.deepEqual(update, { $set: { status: "withdrawn" } });
      return { status: "withdrawn" };
    });
    replace(CircleMember, "aggregate", async () => []);
    replace(CirclePollVote, "aggregate", async () => []);
    replace(membership, "organizerIds", async () => []);
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("withdraws only the caller's pending membership request", async () => {
    const result = await service.withdrawJoinRequest(userId, String(circleId));
    assert.equal(result.status, "withdrawn");
    assert.equal(result.circle._id, String(circleId));
    assert.equal(result.circle.name, "Circle");
  });

  it("returns not found when the caller has no pending request", async () => {
    const original = CircleMember.findOneAndUpdate;
    CircleMember.findOneAndUpdate = async () => null;
    try {
      await assert.rejects(service.withdrawJoinRequest(userId, String(circleId)), (error) => {
        assert.equal(error.statusCode, 404);
        assert.equal(error.translationKey, "circle_request_not_found");
        return true;
      });
    } finally {
      CircleMember.findOneAndUpdate = original;
    }
  });

  it("includes membership status in latest members", async () => {
    const memberUserId = new mongoose.Types.ObjectId();
    const member = {
      userId: memberUserId,
      role: "member",
      status: "active",
      joinedAt: new Date("2026-01-01"),
    };
    const circle = {
      _id: circleId,
      creatorId: userId,
      name: "Circle",
      purpose: "Purpose",
      category: new mongoose.Types.ObjectId(),
      privacy: "open",
      polls: [],
    };
    const saved = [];
    const override = (target, method, replacement) => {
      saved.push([target, method, target[method]]);
      target[method] = replacement;
    };
    try {
      override(Circle, "findOne", async () => circle);
      override(CircleMember, "find", (filter) => {
        assert.deepEqual(filter, { circleId, status: "active" });
        return query([member]);
      });
      override(Event, "find", () => query([]));
      override(Drop, "find", () => query([]));
      override(Category, "findById", () => ({ select: () => ({ lean: async () => null }) }));
      override(User, "find", (filter) => {
        assert.deepEqual(filter, { _id: { $in: [memberUserId] } });
        return query([{ _id: memberUserId, name: "Member", handle: "member", profileIcon: "" }]);
      });
      override(membership, "getMember", async () => null);
      override(membership, "activeMemberIds", async () => []);
      override(membership, "organizerIds", async () => []);
      override(membership, "countsFor", async () => new Map());

      const result = await service.getCircle(String(circleId));
      assert.equal(result.viewerMembership, null);
      assert.deepEqual(result.latestPolls, []);
      assert.equal(result.latestMembers[0].userId, String(memberUserId));
      assert.equal(result.latestMembers[0].status, "active");
    } finally {
      for (const [target, method, original] of saved.reverse()) target[method] = original;
    }
  });

  it("returns the caller's pending membership request on circle details", async () => {
    const pendingMembership = {
      _id: new mongoose.Types.ObjectId(),
      role: "member",
      status: "pending",
      joinedAt: null,
    };
    const circle = {
      _id: circleId,
      creatorId: userId,
      name: "Circle",
      purpose: "Purpose",
      category: new mongoose.Types.ObjectId(),
      privacy: "approval",
      polls: [],
    };
    const saved = [];
    const override = (target, method, replacement) => {
      saved.push([target, method, target[method]]);
      target[method] = replacement;
    };
    try {
      override(Circle, "findOne", async () => circle);
      override(Event, "find", () => query([]));
      override(Drop, "find", () => query([]));
      override(Category, "findById", () => ({ select: () => ({ lean: async () => null }) }));
      override(membership, "getMember", async (_circleId, _viewerId, options) => {
        assert.deepEqual(options, { status: null });
        return pendingMembership;
      });
      override(membership, "activeMemberIds", async () => []);
      override(membership, "organizerIds", async () => []);
      override(membership, "countsFor", async () => new Map());

      const result = await service.getCircle(String(circleId), String(userId));
      assert.deepEqual(result.viewerMembership, {
        _id: String(pendingMembership._id),
        role: "member",
        status: "pending",
        joinedAt: null,
      });
      assert.deepEqual(result.latestMembers, []);
    } finally {
      for (const [target, method, original] of saved.reverse()) target[method] = original;
    }
  });

  it("returns the two newest active polls with the viewer's vote", async () => {
    const makePoll = (question, status, closesAt) => ({
      _id: new mongoose.Types.ObjectId(),
      question,
      options: ["Yes", "No"],
      createdBy: userId,
      closesAt: new Date(closesAt),
      status,
    });
    const polls = [
      makePoll("Old active", "active", "2999-01-01"),
      makePoll("Next active", "active", "2999-01-01"),
      makePoll("Explicitly closed", "closed", "2999-01-01"),
      makePoll("Newest active", "active", "2999-01-01"),
      makePoll("Expired", "active", "2000-01-01"),
    ];
    const circle = {
      _id: circleId,
      creatorId: userId,
      name: "Circle",
      purpose: "Purpose",
      category: new mongoose.Types.ObjectId(),
      privacy: "approval",
      polls,
    };
    const saved = [];
    const override = (target, method, replacement) => {
      saved.push([target, method, target[method]]);
      target[method] = replacement;
    };
    try {
      override(Circle, "findOne", async () => circle);
      override(Event, "find", () => query([]));
      override(Drop, "find", () => query([]));
      override(Category, "findById", () => ({ select: () => ({ lean: async () => null }) }));
      override(membership, "getMember", async () => null);
      override(membership, "activeMemberIds", async () => []);
      override(membership, "organizerIds", async () => []);
      override(membership, "countsFor", async () => new Map());
      override(CirclePollVote, "aggregate", async (pipeline) => {
        assert.deepEqual(pipeline[0].$match, { circleId: { $in: [circleId] } });
        const viewer = pipeline[1].$group.viewerVotes.$sum.$cond[0].$eq[1];
        const viewerVotes = viewer && String(viewer) === String(userId) ? 1 : 0;
        return [
          { _id: { circleId, pollId: polls[1]._id, optionIndex: 0 }, count: 1, viewerVotes },
          { _id: { circleId, pollId: polls[3]._id, optionIndex: 0 }, count: 1, viewerVotes },
          { _id: { circleId, pollId: polls[3]._id, optionIndex: 1 }, count: 1, viewerVotes: 0 },
        ];
      });

      const result = await service.getCircle(String(circleId), String(userId));
      assert.deepEqual(result.latestPolls.map((poll) => poll._id), [String(polls[3]._id), String(polls[1]._id)]);
      assert.deepEqual(result.latestPolls.map((poll) => poll.myVote), [0, 0]);
      assert.deepEqual(result.latestPolls[0].voteCounts, [1, 1]);
      assert.equal(result.latestPolls[0].voteCount, 2);
      assert.deepEqual(result.polls[3].voteCounts, [1, 1]);
      assert.equal(result.polls.length, 5);
      assert.equal(result.poll._id, String(polls[4]._id));
      assert.equal(result.poll.status, "closed");

      const anonymous = await service.getCircle(String(circleId));
      assert.deepEqual(anonymous.latestPolls.map((poll) => poll.myVote), [null, null]);

      membership.getMember = async () => ({ status: "active", role: "member" });
      const listed = await service.listPolls(String(userId), String(circleId), {
        user: { _id: userId },
        query: { status: "active" },
      });
      assert.deepEqual(listed.data.map((poll) => poll._id), [
        String(polls[3]._id),
        String(polls[1]._id),
        String(polls[0]._id),
      ]);
      assert.equal(listed.data[1].myVote, 0);
    } finally {
      for (const [target, method, original] of saved.reverse()) target[method] = original;
    }
  });
});
