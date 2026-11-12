const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CirclePollVote = require("../../backend/models/CirclePollVote");
const membership = require("../../backend/roles/user/circles/membership");
const service = require("../../backend/roles/user/circles/service");
const controller = require("../../backend/roles/user/circles/controller");
const routes = require("../../backend/roles/user/circles/routes");

describe("close Circle poll early", () => {
  const circleId = new mongoose.Types.ObjectId();
  const pollId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const originals = [];
  let circle;
  let role;
  let app;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }

  before(() => {
    replace(Circle, "findOne", async () => circle);
    replace(membership, "getMember", async () => role && { status: "active", role });
    replace(Circle, "findOneAndUpdate", async (filter, update, options) => {
      assert.equal(String(filter._id), String(circleId));
      assert.equal(filter.deletedAt, null);
      assert.equal(String(filter.polls.$elemMatch._id), String(pollId));
      assert.equal(filter.polls.$elemMatch.status, "active");
      const now = filter.polls.$elemMatch.closesAt.$gt;
      assert.ok(now instanceof Date);
      assert.deepEqual(options, { new: true, runValidators: true });
      assert.deepEqual(update, { $set: { "polls.$.status": "closed", "polls.$.closesAt": now } });
      const poll = circle.polls.find((item) => String(item._id) === String(pollId));
      if (!poll || poll.status !== "active" || poll.closesAt <= now) return null;
      poll.status = "closed";
      poll.closesAt = now;
      return circle;
    });
    replace(CirclePollVote, "aggregate", async (pipeline) => {
      assert.deepEqual(pipeline[0].$match, { circleId: { $in: [circleId] } });
      assert.equal(String(pipeline[1].$group.viewerVotes.$sum.$cond[0].$eq[1]), String(userId));
      return [
        { _id: { circleId, pollId, optionIndex: 0 }, count: 2, viewerVotes: 1 },
        { _id: { circleId, pollId, optionIndex: 1 }, count: 1, viewerVotes: 0 },
      ];
    });
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: userId };
      req.__ = (key) => key;
      next();
    });
    app.post("/circles/:id/polls/:pollId/close", controller.closePoll);
  });

  beforeEach(() => {
    role = "organizer";
    circle = {
      _id: circleId,
      polls: [{
        _id: pollId,
        question: "Choose",
        options: ["Yes", "No"],
        createdBy: userId,
        status: "active",
        closesAt: new Date("2999-01-01"),
      }],
    };
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("wires the authenticated route and returns the closed poll with separate vote results", async () => {
    const route = routes.stack.find((layer) => layer.route?.path === "/circles/:id/polls/:pollId/close");
    assert.ok(route?.route.methods.post);
    assert.ok(route.route.stack.length > 1);
    const before = Date.now();
    const { body } = await supertest(app).post(`/circles/${circleId}/polls/${pollId}/close`).expect(200);
    assert.equal(body.data.status, "closed");
    assert.ok(new Date(body.data.closesAt).getTime() >= before);
    assert.equal(body.data.voteCount, 3);
    assert.deepEqual(body.data.voteCounts, [2, 1]);
    assert.equal(body.data.myVote, 0);
    await assert.rejects(service.votePoll(String(userId), String(circleId), String(pollId), 0),
      (error) => error.statusCode === 409 && error.translationKey === "poll_closed");
  });

  it("rejects non-organizers and non-members", async () => {
    for (const memberRole of ["member", null]) {
      role = memberRole;
      await assert.rejects(service.closePoll(String(userId), String(circleId), String(pollId)),
        (error) => error.statusCode === 403);
      assert.equal(circle.polls[0].status, "active");
    }
  });

  it("rejects missing and malformed poll IDs", async () => {
    for (const id of ["invalid", String(new mongoose.Types.ObjectId())]) {
      await assert.rejects(service.closePoll(String(userId), String(circleId), id),
        (error) => error.statusCode === 404 && error.translationKey === "circle_poll_not_found");
    }
  });

  it("rejects closed and expired polls without changing them", async () => {
    for (const poll of [
      { status: "closed", closesAt: new Date("2999-01-01") },
      { status: "active", closesAt: new Date("2000-01-01") },
    ]) {
      Object.assign(circle.polls[0], poll);
      await assert.rejects(service.closePoll(String(userId), String(circleId), String(pollId)),
        (error) => error.statusCode === 409 && error.translationKey === "poll_closed");
      assert.equal(circle.polls[0].status, poll.status);
      assert.equal(circle.polls[0].closesAt, poll.closesAt);
    }
  });

  it("allows a new poll after early closure", async () => {
    await service.closePoll(String(userId), String(circleId), String(pollId));
    const original = Circle.findOneAndUpdate;
    Circle.findOneAndUpdate = async (filter, update) => {
      const now = filter.$expr.$lt[0].$size.$filter.cond.$and[1].$gt[1];
      assert.ok(circle.polls.every((poll) => poll.status !== "active" || poll.closesAt <= now));
      circle.polls.push(update.$push.polls);
      return circle;
    };
    try {
      const result = await service.createPoll(String(userId), String(circleId), {
        question: "Next", options: ["Yes", "No"],
      });
      assert.equal(result.status, "active");
      assert.equal(circle.polls.length, 2);
    } finally {
      Circle.findOneAndUpdate = original;
    }
  });
});
