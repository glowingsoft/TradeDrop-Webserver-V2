const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CirclePollVote = require("../../backend/models/CirclePollVote");
const membership = require("../../backend/roles/user/circles/membership");
const service = require("../../backend/roles/user/circles/service");

describe("separate Circle poll votes", () => {
  const circleId = new mongoose.Types.ObjectId();
  const pollId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const originals = [];
  let circle;
  let votes;

  function replace(target, method, value) {
    originals.push([target, method, target[method]]);
    target[method] = value;
  }

  before(() => {
    replace(mongoose, "startSession", async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    }));
    replace(Circle, "findOne", async () => circle);
    replace(membership, "getMember", async () => ({ status: "active", role: "member" }));
    replace(Circle, "updateOne", async (filter, update, options) => {
      assert.equal(String(filter.polls.$elemMatch._id), String(pollId));
      assert.ok(filter.polls.$elemMatch.closesAt.$gt instanceof Date);
      assert.deepEqual(update, { $inc: { "polls.$.voteVersion": 1 } });
      assert.ok(options.session);
      return { matchedCount: 1 };
    });
    replace(CirclePollVote, "create", async ([vote], options) => {
      assert.ok(options.session);
      if (votes.some((item) => String(item.userId) === String(vote.userId))) {
        const error = new Error("duplicate");
        error.code = 11000;
        throw error;
      }
      votes.push(vote);
    });
    replace(CirclePollVote, "aggregate", async (pipeline) => {
      assert.deepEqual(pipeline[0].$match, { circleId: { $in: [circleId] } });
      const viewer = pipeline[1].$group.viewerVotes.$sum.$cond[0].$eq[1];
      return votes.map((vote) => ({
        _id: { circleId: vote.circleId, pollId: vote.pollId, optionIndex: vote.optionIndex },
        count: 1,
        viewerVotes: viewer && String(viewer) === String(vote.userId) ? 1 : 0,
      }));
    });
  });

  beforeEach(() => {
    circle = {
      _id: circleId,
      polls: [{
        _id: pollId,
        createdBy: otherId,
        question: "Choose",
        options: ["One", "Two"],
        status: "active",
        closesAt: new Date("2999-01-01"),
      }],
    };
    votes = [];
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("defines a unique index per circle, poll and user", () => {
    assert.ok(CirclePollVote.schema.indexes().some(
      ([keys, options]) => JSON.stringify(keys) === JSON.stringify({ circleId: 1, pollId: 1, userId: 1 }) && options.unique,
    ));
    assert.equal(Circle.schema.path("polls").schema.path("votes"), undefined);
  });

  it("records distinct users' votes and rejects a duplicate", async () => {
    const first = await service.votePoll(String(userId), String(circleId), String(pollId), 0);
    assert.equal(first.myVote, 0);
    assert.deepEqual(first.voteCounts, [1, 0]);
    const second = await service.votePoll(String(otherId), String(circleId), String(pollId), 1);
    assert.equal(second.myVote, 1);
    assert.deepEqual(second.voteCounts, [1, 1]);
    assert.equal(second.voteCount, 2);
    assert.equal(circle.polls[0].votes, undefined);
    await assert.rejects(service.votePoll(String(userId), String(circleId), String(pollId), 1),
      (error) => error.statusCode === 409 && error.translationKey === "poll_vote_duplicate_or_closed");
  });

  it("lists votes from the separate collection", async () => {
    votes = [
      { circleId, pollId, userId, optionIndex: 0 },
      { circleId, pollId, userId: otherId, optionIndex: 1 },
    ];
    const result = await service.listPolls(String(userId), String(circleId), { user: { _id: userId }, query: {} });
    assert.equal(result.data[0].myVote, 0);
    assert.equal(result.data[0].voteCount, 2);
    assert.deepEqual(result.data[0].voteCounts, [1, 1]);
  });

  it("includes separate vote totals in Circle list responses", async () => {
    votes = [{ circleId, pollId, userId, optionIndex: 1 }];
    const saved = [];
    const override = (target, method, replacement) => {
      saved.push([target, method, target[method]]);
      target[method] = replacement;
    };
    const query = {
      sort: () => query,
      skip: () => query,
      limit: () => query,
      lean: async () => [circle],
    };
    try {
      override(Circle, "find", () => query);
      override(Circle, "countDocuments", async () => 1);
      override(membership, "circleIdsFor", async () => [circleId]);
      override(membership, "countsFor", async () => new Map());
      const result = await service.listMyCircles(String(userId), { query: {} });
      assert.equal(result.data[0].poll.voteCount, 1);
      assert.deepEqual(result.data[0].polls[0].voteCounts, [0, 1]);
    } finally {
      for (const [target, method, original] of saved.reverse()) target[method] = original;
    }
  });

  it("rejects a vote if the poll closes before the transactional update", async () => {
    const original = Circle.updateOne;
    Circle.updateOne = async () => ({ matchedCount: 0 });
    try {
      await assert.rejects(service.votePoll(String(userId), String(circleId), String(pollId), 0),
        (error) => error.statusCode === 409 && error.translationKey === "poll_vote_duplicate_or_closed");
      assert.equal(votes.length, 0);
    } finally {
      Circle.updateOne = original;
    }
  });
});
