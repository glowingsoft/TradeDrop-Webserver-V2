const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const membership = require("../../backend/roles/user/circles/membership");
const service = require("../../backend/roles/user/circles/service");

describe("Circle active poll limit", () => {
  const circleId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const originals = [];
  let circle;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }

  before(() => {
    replace(Circle, "findOne", async () => circle);
    replace(membership, "getMember", async () => ({ status: "active", role: "organizer" }));
    replace(Circle, "findOneAndUpdate", async (filter, update, options) => {
      assert.equal(String(filter._id), String(circleId));
      assert.equal(filter.deletedAt, null);
      assert.equal(filter.$expr.$lt[1], 1);
      const activeFilter = filter.$expr.$lt[0].$size.$filter;
      assert.deepEqual(activeFilter.cond.$and[0], { $eq: ["$$poll.status", "active"] });
      const now = activeFilter.cond.$and[1].$gt[1];
      assert.ok(now instanceof Date);
      assert.equal(activeFilter.cond.$and[1].$gt[0], "$$poll.closesAt");
      assert.deepEqual(options, { new: true, runValidators: true });
      if (circle.polls.filter((poll) => poll.status === "active" && poll.closesAt > now).length >= 1) return null;
      circle.polls.push(update.$push.polls);
      return circle;
    });
  });

  beforeEach(() => {
    circle = { _id: circleId, polls: [] };
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("creates one active poll and rejects another", async () => {
    const body = { question: "Choose", options: ["Yes", "No"] };
    const created = await service.createPoll(String(userId), String(circleId), body);
    assert.equal(created.status, "active");
    assert.equal(circle.polls.length, 1);
    await assert.rejects(service.createPoll(String(userId), String(circleId), body),
      (error) => error.statusCode === 409 && error.translationKey === "active_poll_limit_reached");
    assert.equal(circle.polls.length, 1);
  });

  it("allows a new poll after prior polls have closed or expired", async () => {
    circle.polls = [
      { status: "closed", closesAt: new Date("2999-01-01") },
      { status: "active", closesAt: new Date("2000-01-01") },
    ];
    const created = await service.createPoll(String(userId), String(circleId), {
      question: "Next",
      options: ["Yes", "No"],
    });
    assert.equal(created.question, "Next");
    assert.equal(circle.polls.length, 3);
  });
});
