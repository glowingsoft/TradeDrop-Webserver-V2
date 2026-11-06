const assert = require("node:assert/strict");
const path = require("node:path");
const moduleAlias = require("module-alias");
const mongoose = require("mongoose");
const express = require("express");
const supertest = require("supertest");

for (const [alias, target] of Object.entries(require("../../aliasConfig/pathAliases.config"))) {
  moduleAlias.addAlias(alias, path.resolve(__dirname, "../..", target));
}

const { User } = require("../../backend/models/UserModel");
const BlockedUser = require("../../backend/models/BlockedUser");
const Connection = require("../../backend/models/Connection");
const ConnectionRequest = require("../../backend/models/ConnectionRequest");
const Circle = require("../../backend/models/Circle");
const Trade = require("../../backend/models/Trade");
const { Drop } = require("../../backend/models/Drop");
const { getFullImageUrl } = require("../../backend/helperUtils/imageHelper");
const router = require("../../backend/roles/user/radar/radarRoutes");

describe("GET /radar/people/:id", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const connectionId = new mongoose.Types.ObjectId();
  const dropId = new mongoose.Types.ObjectId();
  const original = {};
  let state;
  let app;

  function query(value, label) {
    const result = {};
    for (const method of ["sort", "skip", "limit", "populate", "select"]) {
      result[method] = (...args) => {
        if (method === "skip" || method === "limit") state[method] = args[0];
        if (label) state[`${label}_${method}`] = args[0];
        return result;
      };
    }
    result.lean = async () => value;
    return result;
  }

  before(() => {
    for (const [model, methods] of [
      [User, ["aggregate"]],
      [BlockedUser, ["findOne"]],
      [Connection, ["find", "countDocuments", "aggregate"]],
      [ConnectionRequest, ["find"]],
      [Circle, ["find"]],
      [Trade, ["find", "countDocuments"]],
      [Drop, ["find", "countDocuments"]],
    ]) {
      for (const method of methods) original[`${model.modelName}.${method}`] = model[method];
    }
  });

  beforeEach(() => {
    state = {
      blocked: null,
      users: [{ _id: userId, name: "Person", profileIcon: "avatar.png", lat: 1.23456, lng: 2.34567 }],
      connection: null,
      request: null,
      drops: [{ _id: dropId, ownerId: userId, status: "open", visibility: "public", referenceImages: [] }],
      total: 1,
    };
    User.aggregate = async (pipeline) => {
      state.userMatch = pipeline[0].$match;
      return state.users;
    };
    BlockedUser.findOne = (filter) => {
      state.blockFilter = filter;
      return query(state.blocked);
    };
    Connection.find = (filter) => {
      state.connectionFilter = filter;
      return query(state.connection ? [{ ...state.connection, pairKey: Connection.pairKeyFor(viewerId, userId), status: "active" }] : []);
    };
    Connection.countDocuments = async (filter) => {
      state.connectionCountFilter = filter;
      return 3;
    };
    Connection.aggregate = async (pipeline) => {
      state.latestConnectionsPipeline = pipeline;
      return state.latestConnections || [];
    };
    ConnectionRequest.find = (filter) => {
      state.requestFilter = filter;
      return query(state.request ? [{ ...state.request, pairKey: Connection.pairKeyFor(viewerId, userId) }] : []);
    };
    Circle.find = (filter) => {
      state.circleFilter = filter;
      return query(state.circles || [], "circle");
    };
    Trade.find = (filter) => {
      state.tradeFilter = filter;
      return query(state.collaborations || [], "trade");
    };
    Trade.countDocuments = async (filter) => {
      state.mutualCollaborationFilter = filter;
      return state.mutualCollaborationCount || 0;
    };
    Drop.find = (filter) => {
      state.dropFilter = filter;
      return query(state.drops);
    };
    Drop.countDocuments = async (filter) => {
      state.countFilter = filter;
      return state.total;
    };
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: viewerId };
      req.__ = (key) => key;
      next();
    });
    app.use("/radar", router);
  });

  after(() => {
    for (const [model, methods] of [
      [User, ["aggregate"]],
      [BlockedUser, ["findOne"]],
      [Connection, ["find", "countDocuments", "aggregate"]],
      [ConnectionRequest, ["find"]],
      [Circle, ["find"]],
      [Trade, ["find", "countDocuments"]],
      [Drop, ["find", "countDocuments"]],
    ]) {
      for (const method of methods) model[method] = original[`${model.modelName}.${method}`];
    }
  });

  it("returns an active connection and public open Drops", async () => {
    state.connection = { _id: connectionId };
    const response = await supertest(app).get(`/radar/people/${userId}?page=2&limit=1`).expect(200);
    const person = response.body.data;
    assert.equal(person.profileIcon, getFullImageUrl("avatar.png"));
    assert.equal(person.lat, 1.235);
    assert.equal(person.hasConnection, true);
    assert.equal(person.connectionId, String(connectionId));
    assert.equal(person.requestSent, false);
    assert.equal(person.connectionStatus, "connected");
    assert.equal(person.openDrops[0]._id, String(dropId));
    assert.equal(person.connectionCount, 3);
    assert.equal(person.mutualCollaborationCount, 0);
    assert.deepEqual(person.latestConnections, []);
    assert.deepEqual(person.latestCollaborations, []);
    assert.deepEqual(person.latestCircles, []);
    assert.equal(state.skip, 1);
    assert.equal(state.limit, 1);
    assert.equal(state.connectionFilter.status, "active");
    assert.equal(state.dropFilter.visibility, "public");
    assert.equal(state.dropFilter.status, "open");
    assert.equal(state.dropFilter.deletedAt, null);
    assert.equal(String(state.dropFilter.ownerId), String(userId));
    assert.ok(state.dropFilter.$or.some((entry) => entry.expiresAt?.$gt instanceof Date));
    assert.equal(state.tradeFilter.kind, "collaboration");
    assert.equal(state.tradeFilter.status, "completed");
    assert.equal(state.circleFilter.deletedAt, null);
    assert.equal(String(state.circleFilter.creatorId), String(userId));
    assert.equal(state.circleFilter.privacy, undefined);
    assert.equal(state.userMatch.radarVisible.$ne, false);
    assert.equal(state.userMatch.hideFromSearch.$ne, true);
  });

  it("returns two latest visible connection profiles", async () => {
    const peerId = new mongoose.Types.ObjectId();
    state.latestConnections = [
      { _id: viewerId, name: "Viewer", handle: "viewer", profileIcon: "viewer.png" },
      { _id: peerId, name: "Peer", handle: "peer", profileIcon: "https://example.com/peer.png" },
    ];
    const { body } = await supertest(app).get(`/radar/people/${userId}`).expect(200);
    assert.deepEqual(body.data.latestConnections.map((item) => item._id), [String(viewerId), String(peerId)]);
    assert.equal(body.data.latestConnections[0].profileIcon, getFullImageUrl("viewer.png"));
    assert.equal(body.data.latestConnections[1].profileIcon, "https://example.com/peer.png");
    const pipeline = state.latestConnectionsPipeline;
    assert.equal(pipeline[0].$match.status, "active");
    assert.deepEqual(pipeline[1].$sort, { updatedAt: -1, _id: -1 });
    const visibility = pipeline.find((stage) => stage.$match?.["peer.accountState.status"]).$match;
    assert.equal(visibility["peer.deletedAt"], null);
    assert.equal(visibility.$or[1]["peer.hideFromSearch"].$ne, true);
    const blockLookup = pipeline.find((stage) => stage.$lookup?.from === BlockedUser.collection.name).$lookup;
    assert.equal(blockLookup.pipeline[0].$match.$expr.$or.length, 2);
    const blockedFilter = pipeline.findIndex((stage) => stage.$match?.["blocks.0"]);
    assert.ok(blockedFilter < pipeline.findIndex((stage) => stage.$limit === 2));
  });

  it("distinguishes outgoing, incoming and declined requests", async () => {
    for (const [request, status, sent, canSend] of [
      [{ _id: connectionId, status: "pending", requesterId: viewerId, recipientId: userId }, "request_sent", true, false],
      [{ status: "pending", requesterId: userId, recipientId: viewerId }, "incoming_request", false, false],
      [{ status: "declined", cooldownUntil: new Date(Date.now() + 60000) }, "declined", false, false],
      [{ status: "declined", cooldownUntil: new Date(Date.now() - 60000) }, "declined", false, true],
      [null, "not_connected", false, true],
    ]) {
      state.request = request;
      const { body } = await supertest(app).get(`/radar/people/${userId}`).expect(200);
      assert.equal(body.data.connectionStatus, status);
      assert.equal(body.data.requestSent, sent);
      assert.equal(body.data.hasConnection, false);
      assert.equal(body.data.connectionId, sent ? String(connectionId) : null);
      assert.equal(body.data.canSendConnectionRequest, canSend);
    }
  });

  it("returns created circles and counts mutual active and completed collaborations", async () => {
    const circleId = new mongoose.Types.ObjectId();
    const privateCircleId = new mongoose.Types.ObjectId();
    const tradeId = new mongoose.Types.ObjectId();
    state.circles = [{ _id: circleId, name: "Circle" }, { _id: privateCircleId, name: "Private circle", privacy: "invite_only" }];
    state.collaborations = [{ _id: tradeId, kind: "collaboration", status: "completed" }];
    state.mutualCollaborationCount = 3;
    const { body } = await supertest(app).get(`/radar/people/${userId}`).expect(200);
    assert.equal(body.data.latestCollaborations.length, 1);
    assert.equal(body.data.latestCircles.length, 2);
    assert.equal(body.data.latestCircles[1].privacy, "invite_only");
    assert.equal(body.data.mutualCollaborationCount, 3);
    assert.equal(state.trade_limit, 2);
    assert.equal(state.circle_limit, 2);
    assert.equal(state.trade_select, "_id kind status completedAt createdAt");
    assert.equal(String(state.circleFilter.creatorId), String(userId));
    assert.equal(state.circleFilter.deletedAt, null);
    assert.equal(state.circleFilter.privacy, undefined);
    assert.deepEqual(state.circle_sort, { updatedAt: -1, _id: -1 });
    const filter = state.mutualCollaborationFilter;
    assert.equal(filter.kind, "collaboration");
    assert.deepEqual(filter.status.$in, ["active", "completed"]);
    assert.equal(String(filter.$or[0].requesterId), String(viewerId));
    assert.equal(String(filter.$or[0].responderId), String(userId));
    assert.equal(String(filter.$or[1].requesterId), String(userId));
    assert.equal(String(filter.$or[1].responderId), String(viewerId));
    assert.equal(state.connectionCountFilter.status, "active");
  });

  it("rejects blocked, missing, invalid and self profiles", async () => {
    state.blocked = { blockedBy: viewerId, blockedUser: userId };
    await supertest(app).get(`/radar/people/${userId}`).expect(404);
    assert.equal(state.blockFilter.$or.length, 2);
    state.blocked = null;
    state.users = [];
    await supertest(app).get(`/radar/people/${userId}`).expect(404);
    await supertest(app).get("/radar/people/invalid").expect(404);
    await supertest(app).get(`/radar/people/${viewerId}`).expect(404);
  });

  it("requires authentication", async () => {
    const anonymous = express();
    anonymous.use((req, res, next) => { req.__ = (key) => key; next(); });
    anonymous.use("/radar", router);
    await supertest(anonymous).get(`/radar/people/${userId}`).expect(401);
  });

  it("returns an error when the database query fails", async () => {
    User.aggregate = async () => { throw new Error("database unavailable"); };
    await supertest(app).get(`/radar/people/${userId}`).expect(500);
  });
});
