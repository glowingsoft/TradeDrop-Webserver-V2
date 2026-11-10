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

describe("sent activity tap-ins", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const responderId = new mongoose.Types.ObjectId();
  const missingId = new mongoose.Types.ObjectId();
  const dropId = new mongoose.Types.ObjectId();
  const missingDropId = new mongoose.Types.ObjectId();
  const tapInId = new mongoose.Types.ObjectId();
  const originals = [];
  let baseUrl;
  let app;
  let userFilter;
  let dropFilter;

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
    baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: viewerId };
      req.__ = (key) => key;
      next();
    });
    app.get("/activity/:tab", controller.get);
    replace(CircleMember, "distinct", async () => []);
    for (const model of [Circle, Event]) {
      replace(model, "find", () => query([]));
      replace(model, "countDocuments", async () => 0);
    }
    replace(ConnectionRequest, "find", () => query([{ recipientId: responderId, requesterId: viewerId }]));
    replace(ConnectionRequest, "countDocuments", async () => 1);
    replace(TapIn, "find", (filter) => {
      assert.deepEqual(filter, { requesterId: viewerId, deletedAt: null });
      return query([
        { _id: tapInId, requesterId: viewerId, responderId, dropId, status: "pending" },
        { _id: new mongoose.Types.ObjectId(), requesterId: viewerId, responderId: missingId, dropId: missingDropId, status: "declined" },
      ]);
    });
    replace(TapIn, "countDocuments", async () => 2);
    replace(User, "find", (filter) => {
      userFilter = filter;
      return query([{ _id: responderId, name: "Responder", profileIcon: "avatar.png", email: "private" }]);
    });
    replace(Drop, "find", (filter) => {
      dropFilter = filter;
      return query([{ _id: dropId, title: "Drop", idea: "Idea", ownerId: responderId }]);
    });
  });

  after(() => {
    for (const [model, method, original] of originals.reverse()) model[method] = original;
    if (baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = baseUrl;
  });

  it("populates sent tap-in drop and responder without changing other fields", async () => {
    const { body } = await supertest(app).get("/activity/sent").expect(200);
    assert.deepEqual(body.data.tapIns[0], {
      _id: String(tapInId),
      requesterId: String(viewerId),
      responderId: { _id: String(responderId), name: "Responder", profileIcon: "https://images.example.com/avatar.png" },
      dropId: { _id: String(dropId), title: "Drop", idea: "Idea" },
      status: "pending",
    });
    assert.equal(body.data.tapIns[1].dropId, null);
    assert.equal(body.data.tapIns[1].responderId, null);
    assert.deepEqual(body.data.connectionRequests[0].recipientId, body.data.tapIns[0].responderId);
    assert.equal(body.meta.tapIns.totalRecords, 2);
    assert.deepEqual(userFilter._id.$in, [String(responderId), String(missingId)]);
    assert.deepEqual(dropFilter._id.$in, [String(dropId), String(missingDropId)]);
  });

  it("only looks up references for the requested page", async () => {
    const { body } = await supertest(app).get("/activity/sent?page=2&limit=1").expect(200);
    assert.equal(body.data.tapIns.length, 1);
    assert.equal(body.data.tapIns[0].responderId, null);
    assert.equal(body.data.tapIns[0].dropId, null);
    assert.equal(body.meta.tapIns.totalRecords, 2);
    assert.deepEqual(userFilter._id.$in, [String(missingId)]);
    assert.deepEqual(dropFilter._id.$in, [String(missingDropId)]);
  });
});
