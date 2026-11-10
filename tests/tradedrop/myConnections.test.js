const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Connection = require("../../backend/models/Connection");
const { User } = require("../../backend/models/UserModel");
const controller = require("../../backend/roles/user/connections/controller");
const router = require("../../backend/roles/user/connections/routes");

describe("my connections", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const peerId = new mongoose.Types.ObjectId();
  const secondPeerId = new mongoose.Types.ObjectId();
  let originalAggregate;
  let baseUrl;
  let pipeline;
  let app;

  before(() => {
    originalAggregate = Connection.aggregate;
    baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: viewerId };
      req.__ = (key) => key;
      next();
    });
    app.get("/me/connections", controller.myConnections);
  });

  after(() => {
    Connection.aggregate = originalAggregate;
    if (baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = baseUrl;
  });

  it("returns paginated active peer profiles with full image URLs", async () => {
    Connection.aggregate = async (stages) => {
      pipeline = stages;
      return [{
        items: [
          { _id: peerId, name: "First", profileIcon: "avatar.png", email: "private" },
          { _id: secondPeerId, name: "Second", profileIcon: "https://cdn.example.com/avatar.png" },
        ],
        total: [{ count: 5 }],
      }];
    };
    const { body } = await supertest(app).get("/me/connections?page=2&limit=2").expect(200);
    assert.deepEqual(body.data, [
      { _id: String(peerId), name: "First", profileIcon: "https://images.example.com/avatar.png" },
      { _id: String(secondPeerId), name: "Second", profileIcon: "https://cdn.example.com/avatar.png" },
    ]);
    assert.deepEqual(body.meta, { currentPage: 2, totalPages: 3, totalRecords: 5, limit: 2 });
    assert.deepEqual(pipeline[0], {
      $match: { status: "active", $or: [{ userA: viewerId }, { userB: viewerId }] },
    });
    assert.deepEqual(pipeline[1], { $sort: { updatedAt: -1, _id: -1 } });
    assert.deepEqual(pipeline[2].$set.peerId.$cond, [{ $eq: ["$userA", viewerId] }, "$userB", "$userA"]);
    assert.equal(pipeline[3].$lookup.from, User.collection.name);
    assert.deepEqual(pipeline[5], { $match: { "peer.deletedAt": null } });
    assert.deepEqual(pipeline[6].$facet.items.slice(0, 2), [{ $skip: 2 }, { $limit: 2 }]);
  });

  it("returns an empty list and zero count", async () => {
    Connection.aggregate = async () => [{ items: [], total: [] }];
    const { body } = await supertest(app).get("/me/connections").expect(200);
    assert.deepEqual(body.data, []);
    assert.equal(body.meta.totalRecords, 0);
  });

  it("propagates database failures", async () => {
    Connection.aggregate = async () => { throw new Error("database failure"); };
    await supertest(app).get("/me/connections").expect(500);
  });

  it("requires authentication on the mounted route", async () => {
    const securedApp = express();
    securedApp.use((req, res, next) => { req.__ = (key) => key; next(); });
    securedApp.use(router);
    await supertest(securedApp).get("/me/connections").expect(401);
  });
});
