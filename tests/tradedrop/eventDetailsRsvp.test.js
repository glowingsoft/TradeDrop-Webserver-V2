const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Event = require("../../backend/models/Event");
const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const { Drop } = require("../../backend/models/Drop");
const { User } = require("../../backend/models/UserModel");
const service = require("../../backend/roles/user/events/service");

describe("Event detail viewer RSVP", () => {
  const eventId = new mongoose.Types.ObjectId();
  const circleId = new mongoose.Types.ObjectId();
  const creatorId = new mongoose.Types.ObjectId();
  const viewerId = new mongoose.Types.ObjectId();
  const originals = [];
  let event;
  let member;
  let creator;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }
  function query(value) {
    const result = { select: () => result, sort: () => result, lean: async () => value };
    return result;
  }

  before(() => {
    replace(Event, "findById", () => query(event));
    replace(Circle, "findOne", async () => ({ _id: circleId, name: "Design Circle", creatorId }));
    replace(CircleMember, "findOne", () => query(member));
    replace(CircleMember, "find", () => query([]));
    replace(Drop, "find", () => query([]));
    replace(User, "findById", (id) => {
      assert.equal(String(id), String(creatorId));
      return query(creator);
    });
    replace(User, "find", () => query([]));
  });

  beforeEach(() => {
    event = { _id: eventId, circleId, creatorId, status: "published", audience: "public", rsvps: [] };
    member = null;
    creator = { _id: creatorId, name: "Creator", profileIcon: "https://example.com/avatar.png" };
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("returns Circle creator details and permits an authenticated non-RSVP viewer to join", async () => {
    const result = await service.getEvent(String(eventId), String(viewerId));
    assert.deepEqual(result.circle, {
      _id: String(circleId),
      name: "Design Circle",
      creator: { _id: String(creatorId), name: "Creator", profileIcon: "https://example.com/avatar.png" },
    });
    assert.equal(result.myRsvp, null);
    assert.deepEqual(result.viewerRsvp, { status: null, hasPlace: false, canRsvp: true, canCancelRsvp: false });
  });

  it("distinguishes confirmed, pending, waitlisted and cancelled RSVPs", async () => {
    const expected = {
      going: [true, false, true],
      pending: [false, false, true],
      waitlist: [false, false, true],
      cancelled: [false, true, false],
    };
    for (const [status, [hasPlace, canRsvp, canCancelRsvp]] of Object.entries(expected)) {
      event.rsvps = [{ userId: viewerId, status, showToParticipants: false }];
      const result = await service.getEvent(String(eventId), String(viewerId));
      assert.equal(result.myRsvp.status, status);
      assert.deepEqual(result.viewerRsvp, { status, hasPlace, canRsvp, canCancelRsvp });
    }
  });

  it("does not offer RSVP actions to anonymous viewers", async () => {
    const result = await service.getEvent(String(eventId));
    assert.deepEqual(result.viewerRsvp, { status: null, hasPlace: false, canRsvp: false, canCancelRsvp: false });
  });

  it("respects member-only access including admin read access without membership", async () => {
    event.audience = "member_only";
    await assert.rejects(service.getEvent(String(eventId), String(viewerId)),
      (error) => error.statusCode === 404);
    const adminView = await service.getEvent(String(eventId), String(viewerId), true);
    assert.equal(adminView.viewerRsvp.canRsvp, false);
    member = { status: "active", role: "member" };
    const memberView = await service.getEvent(String(eventId), String(viewerId));
    assert.equal(memberView.viewerRsvp.canRsvp, true);
  });

  it("returns null creator when the user profile is unavailable", async () => {
    creator = null;
    const result = await service.getEvent(String(eventId), String(viewerId));
    assert.equal(result.circle.creator, null);
  });
});
