const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Circle = require("../../backend/models/Circle");
const CircleMember = require("../../backend/models/CircleMember");
const ConnectionRequest = require("../../backend/models/ConnectionRequest");
const Event = require("../../backend/models/Event");
const TapIn = require("../../backend/models/TapIn");
const { Drop } = require("../../backend/models/Drop");
const { User } = require("../../backend/models/UserModel");
const controller = require("../../backend/roles/user/activity/controller");

describe("received activity connection requests", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const requestId = new mongoose.Types.ObjectId();
  const originals = [];
  let app;
  let previousBaseUrl;

  function replace(model, method, replacement) {
    originals.push([model, method, model[method]]);
    model[method] = replacement;
  }

  function query(items) {
    let skip = 0;
    let limit = items.length;
    const result = {
      sort: () => result,
      skip: (value) => { skip = value; return result; },
      limit: (value) => { limit = value; return result; },
      select: () => result,
      lean: async () => items.slice(skip, skip + limit),
    };
    return result;
  }

  before(() => {
    previousBaseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: viewerId };
      req.__ = (key) => key;
      next();
    });
    app.get("/activity/:tab", controller.get);

    const requests = [
      { _id: requestId, requesterId, recipientId: viewerId, status: "pending", createdAt: new Date("2026-01-03") },
      { _id: new mongoose.Types.ObjectId(), requesterId: viewerId, recipientId: otherId, status: "pending" },
      { _id: new mongoose.Types.ObjectId(), requesterId: otherId, recipientId: viewerId, status: "accepted" },
    ];
    const matching = (filter) => requests.filter((request) =>
      String(request.recipientId) === String(filter.recipientId) && request.status === filter.status,
    );
    replace(ConnectionRequest, "find", (filter) => query(matching(filter)));
    replace(ConnectionRequest, "countDocuments", async (filter) => matching(filter).length);
    replace(CircleMember, "distinct", async () => []);
    replace(CircleMember, "find", () => query([]));
    for (const model of [Circle, Event, TapIn, Drop]) {
      replace(model, "find", () => query([]));
      replace(model, "countDocuments", async () => 0);
    }
    replace(TapIn, "aggregate", async () => []);
    replace(User, "find", (filter) => {
      assert.deepEqual(filter._id.$in, [String(requesterId)]);
      return query([{ _id: requesterId, name: "Requester", profileIcon: "avatar.png" }]);
    });
  });

  after(() => {
    for (const [model, method, original] of originals.reverse()) model[method] = original;
    if (previousBaseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = previousBaseUrl;
  });

  it("returns pending incoming requests with requester details and excludes outgoing and accepted requests", async () => {
    const response = await supertest(app).get("/activity/received").expect(200);
    assert.equal(response.body.meta.connectionRequests.totalRecords, 1);
    assert.equal(response.body.data.connectionRequests.length, 1);
    assert.equal(response.body.data.connectionRequests[0]._id, String(requestId));
    assert.deepEqual(response.body.data.connectionRequests[0].requesterId, {
      _id: String(requesterId),
      name: "Requester",
      profileIcon: "https://images.example.com/avatar.png",
    });
    assert.equal(response.body.data.latestRequests[0].type, "connection");
    assert.equal(response.body.data.latestRequests[0].requestId, String(requestId));
  });

  it("populates circle creators, event requesters and tap-in drops without extra fields", async () => {
    const circleId = new mongoose.Types.ObjectId();
    const creatorId = new mongoose.Types.ObjectId();
    const eventId = new mongoose.Types.ObjectId();
    const eventUserId = new mongoose.Types.ObjectId();
    const missingUserId = new mongoose.Types.ObjectId();
    const dropId = new mongoose.Types.ObjectId();
    const missingDropId = new mongoose.Types.ObjectId();
    const saved = [];
    const override = (model, method, replacement) => {
      saved.push([model, method, model[method]]);
      model[method] = replacement;
    };
    try {
      override(CircleMember, "distinct", async (field, filter) =>
        filter.role === "organizer" || filter.status === "pending" ? [circleId] : [],
      );
      override(Circle, "find", (filter) => query(
        filter._id.$in.length ? [{ _id: circleId, name: "Circle", creatorId }] : [],
      ));
      override(Circle, "countDocuments", async () => 1);
      override(Event, "find", () => query([{
        _id: eventId,
        name: "Event",
        updatedAt: new Date("2026-01-01"),
        rsvps: [
          { userId: eventUserId, status: "pending" },
          { userId: missingUserId, status: "pending" },
          { userId: viewerId, status: "pending" },
        ],
      }]));
      override(Event, "countDocuments", async () => 1);
      override(TapIn, "find", () => query([
        { _id: new mongoose.Types.ObjectId(), dropId, requesterId, createdAt: new Date("2026-01-02") },
        { _id: new mongoose.Types.ObjectId(), dropId: missingDropId, requesterId, createdAt: new Date("2026-01-01") },
      ]));
      override(TapIn, "countDocuments", async () => 2);
      override(Drop, "find", (filter) => query(filter._id
        ? [{ _id: dropId, title: "Drop", idea: "Idea", ownerId: viewerId }]
        : []));
      override(User, "find", () => query([
        { _id: requesterId, name: "Requester", profileIcon: "avatar.png" },
        { _id: creatorId, name: "Creator", profileIcon: "creator.png", email: "private" },
        { _id: eventUserId, name: "Guest", profileIcon: "https://cdn.example.com/guest.png", email: "private" },
      ]));

      const { body } = await supertest(app).get("/activity/received").expect(200);
      assert.deepEqual(body.data.circleRequests[0].creatorId, {
        _id: String(creatorId), name: "Creator", profileIcon: "https://images.example.com/creator.png",
      });
      assert.deepEqual(body.data.eventRequests[0].userId, {
        _id: String(eventUserId), name: "Guest", profileIcon: "https://cdn.example.com/guest.png",
      });
      assert.equal(body.data.eventRequests[1].userId, null);
      assert.deepEqual(body.data.tapIns[0].dropId, { _id: String(dropId), title: "Drop", idea: "Idea" });
      assert.equal(body.data.tapIns[1].dropId, null);
      const latestTapIns = body.data.latestRequests.filter((request) => request.type === "tapIn");
      assert.deepEqual(latestTapIns[0].dropId, { _id: String(dropId), title: "Drop", idea: "Idea" });
      assert.equal(latestTapIns[1].dropId, null);
    } finally {
      for (const [model, method, original] of saved.reverse()) model[method] = original;
    }
  });

  it("populates received tap-in requesters independently of the latest requests list", async () => {
    const tapRequesterId = new mongoose.Types.ObjectId();
    const missingRequesterId = new mongoose.Types.ObjectId();
    const dropId = new mongoose.Types.ObjectId();
    const originalTapInFind = TapIn.find;
    const originalTapInCount = TapIn.countDocuments;
    const originalUserFind = User.find;
    const originalDropFind = Drop.find;
    try {
      const tapIns = [
        { _id: new mongoose.Types.ObjectId(), dropId, requesterId: missingRequesterId },
        { _id: new mongoose.Types.ObjectId(), dropId, requesterId: tapRequesterId },
      ];
      let tapInFindCalls = 0;
      let queriedUserIds;
      TapIn.find = () => query(++tapInFindCalls % 2 ? tapIns : tapIns.slice(0, 1));
      TapIn.countDocuments = async () => 2;
      Drop.find = () => query([]);
      User.find = (filter) => {
        queriedUserIds = filter._id.$in;
        return query([
          { _id: requesterId, name: "Requester", profileIcon: "avatar.png" },
          { _id: tapRequesterId, name: "Tap requester", profileIcon: "tap.png", email: "private" },
        ]);
      };
      const { body } = await supertest(app).get("/activity/received?page=2&limit=1").expect(200);
      assert.ok(queriedUserIds.includes(String(tapRequesterId)));
      assert.deepEqual(body.data.tapIns[0].requesterId, {
        _id: String(tapRequesterId),
        name: "Tap requester",
        profileIcon: "https://images.example.com/tap.png",
      });
      assert.equal(body.data.tapIns[0].dropId, null);
      assert.equal(body.meta.tapIns.totalRecords, 2);

      const firstPage = await supertest(app).get("/activity/received?page=1&limit=1").expect(200);
      assert.equal(firstPage.body.data.tapIns[0].requesterId, null);
    } finally {
      TapIn.find = originalTapInFind;
      TapIn.countDocuments = originalTapInCount;
      User.find = originalUserFind;
      Drop.find = originalDropFind;
    }
  });
});
