const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const TapIn = require("../../backend/models/TapIn");
const { Drop } = require("../../backend/models/Drop");
const { User } = require("../../backend/models/UserModel");
const controller = require("../../backend/roles/user/tapIns/controller");
const routes = require("../../backend/roles/user/tapIns/routes");

describe("manage Drop Tap-ins", () => {
  const dropId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const originals = [];
  let drop;
  let rows;
  let pipeline;
  let app;
  let baseUrl;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }
  function query(value) {
    const result = { select: () => result, lean: async () => value };
    return result;
  }

  before(() => {
    baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    replace(Drop, "findOne", (filter) => {
      assert.deepEqual(filter, { _id: dropId, deletedAt: null });
      return query(drop);
    });
    replace(TapIn, "aggregate", async (stages) => {
      pipeline = stages;
      assert.deepEqual(stages[0].$match, { dropId, deletedAt: null });
      const facet = stages[1].$facet;
      const status = facet.items.find((stage) => stage.$match)?.$match.status;
      const visible = rows.filter((row) => String(row.dropId) === String(dropId) && row.deletedAt == null);
      const filtered = status ? visible.filter((row) => row.status === status) : visible;
      const skip = facet.items.find((stage) => Object.hasOwn(stage, "$skip")).$skip;
      const limit = facet.items.find((stage) => stage.$limit).$limit;
      const counts = [...new Set(visible.map((row) => row.status))].map((value) => ({
        _id: value, count: visible.filter((row) => row.status === value).length,
      }));
      return [{ items: filtered.slice(skip, skip + limit), total: filtered.length ? [{ count: filtered.length }] : [], counts }];
    });
    replace(User, "find", (filter) => {
      return query(filter._id.$in.map((id) => {
        assert.ok([String(requesterId), String(ownerId)].includes(id));
        return { _id: id, name: "Requester", handle: "requester", profileIcon: "avatar.png" };
      }));
    });
    app = express();
    app.use((req, res, next) => { req.user = { _id: ownerId }; req.__ = (key) => key; next(); });
    app.get("/drops/:id/tap-ins", controller.manageDropTapIns);
  });

  beforeEach(() => {
    drop = { _id: dropId, ownerId };
    rows = ["pending", "accepted", "pending", "closed", "declined"].map((status) => ({
      _id: new mongoose.Types.ObjectId(), dropId, requesterId, responderId: ownerId, status, deletedAt: null,
    }));
    pipeline = null;
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
    if (baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = baseUrl;
  });

  it("authenticates and returns filtered page with all status counts", async () => {
    const secured = express();
    secured.use((req, res, next) => { req.__ = (key) => key; next(); });
    secured.use(routes);
    await supertest(secured).get(`/drops/${dropId}/tap-ins`).expect(401);
    const { body } = await supertest(app).get(`/drops/${dropId}/tap-ins?status=pending&page=2&limit=1`).expect(200);
    assert.equal(body.meta.totalRecords, 2);
    assert.deepEqual(body.meta.counts, { all: 5, pending: 2, accepted: 1, declined: 1, closed: 1 });
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]._id, String(rows[2]._id));
    assert.deepEqual(body.data[0].requester, {
      _id: String(requesterId), name: "Requester", handle: "requester",
      profileIcon: "https://images.example.com/avatar.png",
    });
    const facet = pipeline[1].$facet;
    assert.deepEqual(facet.items[0], { $match: { status: "pending" } });
    assert.deepEqual(facet.items[1], { $sort: { createdAt: -1, _id: -1 } });
    assert.deepEqual(facet.counts, [{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  });

  it("returns all statuses and zero counts for an empty Drop", async () => {
    rows = [];
    const { body } = await supertest(app).get(`/drops/${dropId}/tap-ins?status=all`).expect(200);
    assert.deepEqual(body.data, []);
    assert.deepEqual(body.meta.counts, { all: 0, pending: 0, accepted: 0, declined: 0, closed: 0 });
    assert.equal(body.meta.totalRecords, 0);
  });

  it("excludes withdrawn requests and requests for other Drops from data and counts", async () => {
    rows.push({ ...rows[0], _id: new mongoose.Types.ObjectId(), status: "closed", deletedAt: new Date() });
    rows.push({ ...rows[0], _id: new mongoose.Types.ObjectId(), dropId: new mongoose.Types.ObjectId() });
    const { body } = await supertest(app).get(`/drops/${dropId}/tap-ins`).expect(200);
    assert.equal(body.data.length, 5);
    assert.equal(body.meta.totalRecords, 5);
    assert.deepEqual(body.meta.counts, { all: 5, pending: 2, accepted: 1, declined: 1, closed: 1 });
  });

  it("filters each supported status and rejects malformed status values", async () => {
    for (const [status, count] of Object.entries({ pending: 2, accepted: 1, declined: 1, closed: 1 })) {
      const { body } = await supertest(app).get(`/drops/${dropId}/tap-ins?status=${status}`).expect(200);
      assert.equal(body.meta.totalRecords, count);
      assert.ok(body.data.every((item) => item.status === status));
      assert.equal(body.meta.counts.all, 5);
    }
    await supertest(app).get(`/drops/${dropId}/tap-ins?status=pending&status=closed`).expect(400);
  });

  it("allows the owner to view their direct request but denies its responder", async () => {
    rows = [{ ...rows[0], requesterId: ownerId, responderId: requesterId }];
    const { body } = await supertest(app).get(`/drops/${dropId}/tap-ins`).expect(200);
    assert.equal(body.data[0].requester._id, String(ownerId));
    assert.equal(body.data[0].responderId, String(requesterId));

    const service = require("../../backend/roles/user/tapIns/service");
    await assert.rejects(service.manageDropTapIns(requesterId, dropId, { query: {} }), { statusCode: 403 });
  });

  it("propagates aggregation errors", async () => {
    const aggregate = TapIn.aggregate;
    try {
      TapIn.aggregate = async () => { throw new Error("database failure"); };
      await supertest(app).get(`/drops/${dropId}/tap-ins`).expect(500);
    } finally {
      TapIn.aggregate = aggregate;
    }
  });

  it("rejects other users, invalid statuses and missing Drops before aggregation", async () => {
    drop.ownerId = new mongoose.Types.ObjectId();
    await supertest(app).get(`/drops/${dropId}/tap-ins`).expect(403);
    assert.equal(pipeline, null);
    drop.ownerId = ownerId;
    await supertest(app).get(`/drops/${dropId}/tap-ins?status=invalid`).expect(400);
    assert.equal(pipeline, null);
    drop = null;
    await supertest(app).get(`/drops/${dropId}/tap-ins`).expect(404);
    await supertest(app).get("/drops/invalid/tap-ins").expect(404);
    assert.equal(pipeline, null);
  });
});
