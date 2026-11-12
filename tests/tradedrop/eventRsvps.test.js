const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Event = require("../../backend/models/Event");
const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const Connection = require("../../backend/models/Connection");
const ConnectionRequest = require("../../backend/models/ConnectionRequest");
const BlockedUser = require("../../backend/models/BlockedUser");
const { User } = require("../../backend/models/UserModel");
const service = require("../../backend/roles/user/events/service");
const controller = require("../../backend/roles/user/events/controller");
const routes = require("../../backend/roles/user/events/routes");

describe("Event RSVP list", () => {
  const eventId = new mongoose.Types.ObjectId();
  const circleId = new mongoose.Types.ObjectId();
  const viewerId = new mongoose.Types.ObjectId();
  const connectedId = new mongoose.Types.ObjectId();
  const incomingId = new mongoose.Types.ObjectId();
  const hiddenId = new mongoose.Types.ObjectId();
  const pendingId = new mongoose.Types.ObjectId();
  const connectionId = new mongoose.Types.ObjectId();
  const originals = [];
  let event;
  let role;
  let app;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }
  function query(result) {
    const q = { select: () => q, sort: () => q, lean: async () => result };
    return q;
  }

  before(() => {
    replace(Event, "findById", () => query(event));
    replace(Circle, "findOne", async () => ({ _id: circleId }));
    replace(CircleMember, "findOne", () => query(role ? { role, status: "active" } : null));
    replace(User, "find", (filter) => query(filter._id.$in.map((id) => ({
      _id: id, name: `User ${id}`, handle: "handle", profileIcon: "avatar.png",
    }))));
    replace(BlockedUser, "find", () => query([{ blockedBy: hiddenId, blockedUser: viewerId }]));
    replace(Connection, "find", (filter) => query(filter.pairKey.$in.includes(Connection.pairKeyFor(viewerId, connectedId))
      ? [{ _id: connectionId, status: "active", pairKey: Connection.pairKeyFor(viewerId, connectedId) }] : []));
    replace(ConnectionRequest, "find", (filter) => query(filter.pairKey.$in.includes(Connection.pairKeyFor(viewerId, incomingId))
      ? [{ _id: new mongoose.Types.ObjectId(), status: "pending", pairKey: Connection.pairKeyFor(viewerId, incomingId), requesterId: incomingId, recipientId: viewerId }] : []));
    app = express();
    app.use((req, res, next) => { req.user = { _id: viewerId }; req.__ = (key) => key; next(); });
    app.get("/events/:id/rsvps", controller.listRsvps);
  });

  beforeEach(() => {
    role = "organizer";
    event = {
      _id: eventId,
      circleId,
      status: "published",
      audience: "public",
      rsvps: [
        { userId: viewerId, status: "going", showToParticipants: false },
        { userId: connectedId, status: "going", showToParticipants: true },
        { userId: incomingId, status: "going", showToParticipants: true },
        { userId: hiddenId, status: "going", showToParticipants: false },
        { userId: pendingId, status: "pending", showToParticipants: false },
      ],
    };
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("returns all RSVP statuses to organizers with profile and connection status", async () => {
    const layer = routes.stack.find((item) => item.route?.path === "/events/:id/rsvps");
    assert.ok(layer?.route.methods.get);
    assert.ok(layer.route.stack.length > 1);
    const { body } = await supertest(app).get(`/events/${eventId}/rsvps`).expect(200);
    assert.equal(body.meta.totalRecords, 5);
    assert.equal(body.data[0].connectionStatus, "self");
    assert.equal(body.data[1].connectionStatus, "connected");
    assert.equal(body.data[1].connectionId, String(connectionId));
    assert.equal(body.data[1].profile._id, String(connectedId));
    assert.equal(body.data[2].connectionStatus, "incoming_request");
    assert.equal(body.data[2].canSendConnectionRequest, false);
    assert.equal(body.data[3].connectionStatus, "not_connected");
    assert.equal(body.data[3].canSendConnectionRequest, false);
    assert.equal(body.data[4].status, "pending");
    assert.equal(body.data[4].canSendConnectionRequest, true);
  });

  it("filters and paginates organizer-only statuses", async () => {
    const req = { user: { _id: viewerId }, query: { status: "pending", limit: "1", page: "1" } };
    const result = await service.listRsvps(String(viewerId), String(eventId), req);
    assert.equal(result.meta.totalRecords, 1);
    assert.equal(result.data[0].userId, String(pendingId));
    assert.equal(result.data[0].status, "pending");
  });

  it("limits members and going participants to visible going attendees", async () => {
    const req = { user: { _id: viewerId }, query: {} };
    for (const memberRole of ["member", null]) {
      role = memberRole;
      const result = await service.listRsvps(String(viewerId), String(eventId), req);
      assert.deepEqual(result.data.map((entry) => entry.userId), [String(connectedId), String(incomingId)]);
      await assert.rejects(service.listRsvps(String(viewerId), String(eventId), {
        ...req, query: { status: "pending" },
      }), (error) => error.statusCode === 403);
    }
  });

  it("denies outsiders, enforces member-only access and rejects invalid statuses", async () => {
    role = null;
    event.rsvps[0].status = "pending";
    const req = { user: { _id: viewerId }, query: {} };
    await assert.rejects(service.listRsvps(String(viewerId), String(eventId), req), (error) => error.statusCode === 403);
    event.audience = "member_only";
    await assert.rejects(service.listRsvps(String(viewerId), String(eventId), req), (error) => error.statusCode === 404);
    role = "organizer";
    await assert.rejects(service.listRsvps(String(viewerId), String(eventId), {
      ...req, query: { status: "invalid" },
    }), (error) => error.statusCode === 400);
  });

  it("permits admins to see hidden RSVP statuses", async () => {
    role = null;
    event.audience = "member_only";
    const result = await service.listRsvps(String(viewerId), String(eventId), {
      user: { _id: viewerId, isAdmin: true }, query: { status: "pending" },
    });
    assert.equal(result.data[0].userId, String(pendingId));
  });
});
