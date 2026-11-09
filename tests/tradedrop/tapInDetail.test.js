const assert = require("node:assert/strict");
const path = require("node:path");
const moduleAlias = require("module-alias");
const mongoose = require("mongoose");
const express = require("express");
const supertest = require("supertest");

for (const [alias, target] of Object.entries(require("../../aliasConfig/pathAliases.config"))) {
  moduleAlias.addAlias(alias, path.resolve(__dirname, "../..", target));
}

const TapIn = require("../../backend/models/TapIn");
const { Drop } = require("../../backend/models/Drop");
const Trade = require("../../backend/models/Trade");
const { User } = require("../../backend/models/UserModel");
const controller = require("../../backend/roles/user/tapIns/controller");
const router = require("../../backend/roles/user/tapIns/routes");
const { getTapIn } = require("../../backend/roles/user/tapIns/service");

describe("Tap In detail", () => {
  const tapInId = new mongoose.Types.ObjectId();
  const dropId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const responderId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const craftId = new mongoose.Types.ObjectId();
  const original = {};
  let state;
  let app;

  before(() => {
    original.findTapIn = TapIn.findOne;
    original.findUser = User.findOne;
    original.countTrades = Trade.countDocuments;
    original.findDrop = Drop.findById;
    original.baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: responderId };
      req.__ = (key) => key;
      next();
    });
    app.get("/tap-ins/:id", controller.getTapIn);
  });

  beforeEach(() => {
    state = {
      tapIn: { _id: tapInId, dropId, requesterId, responderId, status: "pending", deletedAt: null },
      requester: {
        _id: requesterId,
        name: "Requester",
        handle: "requester",
        profileIcon: "avatar.png",
        bio: "Hello",
        specialty: "Woodwork",
        areaLabel: "Central",
        crafts: [{ _id: craftId, name: "Woodwork", image: "wood.png" }],
      },
      userQueries: 0,
      countQueries: 0,
      dropQueries: 0,
      drop: { _id: dropId, offerText: "Offer", needText: "Need", status: "open" },
    };
    TapIn.findOne = (filter) => {
      state.tapInFilter = filter;
      return { lean: async () => state.tapIn };
    };
    User.findOne = (filter) => {
      state.userQueries += 1;
      state.userFilter = filter;
      return {
        select: (fields) => {
          state.userFields = fields;
          return {
            populate: (field, selection) => {
              state.populate = [field, selection];
              return { lean: async () => state.requester };
            },
          };
        },
      };
    };
    Trade.countDocuments = async (filter) => {
      state.countQueries += 1;
      state.countFilter = filter;
      return 4;
    };
    Drop.findById = (id) => {
      state.dropQueries += 1;
      state.dropId = id;
      return {
        select: (fields) => {
          state.dropFields = fields;
          return { lean: async () => state.drop };
        },
      };
    };
  });

  after(() => {
    TapIn.findOne = original.findTapIn;
    User.findOne = original.findUser;
    Trade.countDocuments = original.countTrades;
    Drop.findById = original.findDrop;
    if (original.baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = original.baseUrl;
  });

  it("returns Tap In fields and requester details for the responder", async () => {
    const { body } = await supertest(app).get(`/tap-ins/${tapInId}`).expect(200);
    assert.equal(body.data._id, String(tapInId));
    assert.equal(body.data.requesterId, String(requesterId));
    assert.equal(body.data.responderId, String(responderId));
    assert.equal(body.data.status, "pending");
    assert.deepEqual(body.data.dropId, { _id: String(dropId), offerText: "Offer", needText: "Need", status: "open" });
    assert.equal(String(state.dropId), String(dropId));
    assert.equal(state.dropFields, "offerText needText status");
    assert.deepEqual(body.data.requester, {
      _id: String(requesterId),
      name: "Requester",
      handle: "requester",
      profileIcon: "https://images.example.com/avatar.png",
      bio: "Hello",
      specialty: "Woodwork",
      areaLabel: "Central",
      crafts: [{ _id: String(craftId), name: "Woodwork", image: "https://images.example.com/wood.png" }],
      collaborationCount: 4,
    });
    assert.deepEqual(state.tapInFilter, { _id: tapInId, deletedAt: null });
    assert.deepEqual(state.userFilter, { _id: requesterId, deletedAt: null });
    assert.deepEqual(state.populate, ["crafts", "name image"]);
    assert.deepEqual(state.countFilter, {
      kind: "collaboration",
      status: { $in: ["active", "completed"] },
      $or: [{ requesterId }, { responderId: requesterId }],
    });
  });

  it("requires authentication on the mounted detail route", async () => {
    const securedApp = express();
    securedApp.use((req, res, next) => {
      req.__ = (key) => key;
      next();
    });
    securedApp.use(router);
    await supertest(securedApp).get(`/tap-ins/${tapInId}`).expect(401);
    assert.equal(state.userQueries, 0);
    assert.equal(state.countQueries, 0);
    assert.equal(state.dropQueries, 0);
  });

  it("allows the requester and handles an unavailable requester", async () => {
    state.requester = null;
    const result = await getTapIn(requesterId, tapInId);
    assert.equal(result.requester, null);
    assert.equal(result.requesterId, String(requesterId));
  });

  it("returns null for a missing drop", async () => {
    state.drop = null;
    const result = await getTapIn(requesterId, tapInId);
    assert.equal(result.dropId, null);
  });

  it("rejects other users before loading requester details or counts", async () => {
    await assert.rejects(getTapIn(otherId, tapInId), { statusCode: 403 });
    assert.equal(state.userQueries, 0);
    assert.equal(state.countQueries, 0);
    assert.equal(state.dropQueries, 0);
  });

  it("rejects missing and invalid Tap Ins", async () => {
    state.tapIn = null;
    await assert.rejects(getTapIn(responderId, tapInId), { statusCode: 404 });
    await assert.rejects(getTapIn(responderId, "invalid"), { statusCode: 404 });
    assert.equal(state.userQueries, 0);
    assert.equal(state.countQueries, 0);
    assert.equal(state.dropQueries, 0);
  });

  it("propagates collaboration count errors", async () => {
    Trade.countDocuments = async () => { throw new Error("count failed"); };
    await assert.rejects(getTapIn(responderId, tapInId), { message: "count failed" });
  });

  it("propagates drop lookup errors", async () => {
    Drop.findById = () => ({
      select: () => ({ lean: async () => { throw new Error("drop lookup failed"); } }),
    });
    await assert.rejects(getTapIn(responderId, tapInId), { message: "drop lookup failed" });
  });
});
