const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
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
      assert.equal(result.latestMembers[0].userId, String(memberUserId));
      assert.equal(result.latestMembers[0].status, "active");
    } finally {
      for (const [target, method, original] of saved.reverse()) target[method] = original;
    }
  });
});
