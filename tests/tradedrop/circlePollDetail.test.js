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

describe("single Circle poll", () => {
  const circleId = new mongoose.Types.ObjectId();
  const pollId = new mongoose.Types.ObjectId();
  const otherPollId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const originals = [];
  let circle;
  let member;
  let app;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }

  before(() => {
    replace(Circle, "findOne", async (filter) => {
      assert.equal(filter.deletedAt, null);
      assert.ok(filter._id instanceof mongoose.Types.ObjectId);
      return circle && String(circle._id) === String(filter._id) ? circle : null;
    });
    replace(membership, "getMember", async () => member);
    replace(CirclePollVote, "aggregate", async (pipeline) => {
      assert.deepEqual(pipeline[0].$match, { circleId: { $in: [circleId] } });
      assert.equal(String(pipeline[1].$group.viewerVotes.$sum.$cond[0].$eq[1]), String(userId));
      return [
        { _id: { circleId, pollId, optionIndex: 0 }, count: 2, viewerVotes: 0 },
        { _id: { circleId, pollId, optionIndex: 1 }, count: 1, viewerVotes: 1 },
        { _id: { circleId, pollId: otherPollId, optionIndex: 0 }, count: 5, viewerVotes: 0 },
      ];
    });
    app = express();
    app.use((req, res, next) => { req.user = { _id: userId }; req.__ = (key) => key; next(); });
    app.get("/circles/:id/polls/:pollId", controller.getPoll);
  });

  beforeEach(() => {
    member = { role: "member", status: "active" };
    circle = {
      _id: circleId,
      polls: [
        { _id: pollId, question: "Choose", options: ["Yes", "No"], createdBy: userId, status: "active", closesAt: new Date("2999-01-01") },
        { _id: otherPollId, question: "Older", options: ["Yes", "No"], createdBy: userId, status: "closed", closesAt: new Date("2000-01-01") },
      ],
    };
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("returns the requested poll and its viewer-specific separate vote summary", async () => {
    const route = routes.stack.find((layer) => layer.route?.path === "/circles/:id/polls/:pollId");
    assert.ok(route?.route.methods.get);
    assert.ok(route.route.stack.length > 1);
    const { body } = await supertest(app).get(`/circles/${circleId}/polls/${pollId}`).expect(200);
    assert.equal(body.data._id, String(pollId));
    assert.equal(body.data.circleId, String(circleId));
    assert.equal(body.data.voteCount, 3);
    assert.deepEqual(body.data.voteCounts, [2, 1]);
    assert.equal(body.data.myVote, 1);
  });

  it("returns closed status for expired polls and null when viewer has not voted", async () => {
    const result = await service.getPoll(String(userId), String(circleId), String(otherPollId));
    assert.equal(result.status, "closed");
    assert.equal(result.voteCount, 5);
    assert.equal(result.myVote, null);
  });

  it("rejects missing and malformed IDs and protects member access", async () => {
    for (const id of ["invalid", String(new mongoose.Types.ObjectId())]) {
      await assert.rejects(service.getPoll(String(userId), String(circleId), id),
        (error) => error.statusCode === 404 && error.translationKey === "circle_poll_not_found");
    }
    member = null;
    await assert.rejects(service.getPoll(String(userId), String(circleId), String(pollId)),
      (error) => error.statusCode === 403 && error.translationKey === "circle_membership_required");
    const adminView = await service.getPoll(String(userId), String(circleId), String(pollId), true);
    assert.equal(adminView._id, String(pollId));
  });

  it("does not return a poll through a different Circle ID", async () => {
    await assert.rejects(service.getPoll(String(userId), String(new mongoose.Types.ObjectId()), String(pollId), true),
      (error) => error.statusCode === 404 && error.translationKey === "circle_not_found");
    await assert.rejects(service.getPoll(String(userId), "invalid", String(pollId), true),
      (error) => error.statusCode === 404 && error.translationKey === "circle_not_found");
  });
});
