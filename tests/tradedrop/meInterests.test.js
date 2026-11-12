const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const { User } = require("../../backend/models/UserModel");
const { Drop } = require("../../backend/models/Drop");
const CircleMember = require("../../backend/models/CircleMember");
const Connection = require("../../backend/models/Connection");
const BlockedUser = require("../../backend/models/BlockedUser");
const { Favorites } = require("../../backend/commonModules/favorites/Favorite");
const { Badge } = require("../../backend/models/Badge");
const badgesService = require("../../backend/roles/admin/badges/badgesService");
const controller = require("../../backend/roles/user/me/profileController");

describe("self profile interests", () => {
  const userId = new mongoose.Types.ObjectId();
  const originals = [];
  let document;
  let app;
  let updates;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }
  function query(value) {
    const result = { select: () => result, lean: async () => value };
    return result;
  }

  before(() => {
    replace(User, "findById", () => query({ ...document }));
    replace(User, "findByIdAndUpdate", (id, patch, options) => {
      assert.equal(String(id), String(userId));
      assert.equal(options.runValidators, true);
      updates += 1;
      document = { ...document, ...patch.$set };
      return query({ ...document });
    });
    replace(Drop, "find", () => query([]));
    replace(CircleMember, "distinct", async () => []);
    replace(Connection, "countDocuments", async () => 0);
    replace(Connection, "aggregate", async () => []);
    replace(Favorites, "countDocuments", async () => 0);
    replace(BlockedUser, "countDocuments", async () => 0);
    replace(Badge, "find", () => ({ distinct: async () => [] }));
    replace(badgesService, "listUserBadges", async () => []);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { _id: userId }; req.__ = (key) => key; next(); });
    app.get("/me", controller.getMe);
    app.patch("/me", controller.patchMe);
  });

  beforeEach(() => {
    document = { _id: userId, name: "Me" };
    updates = 0;
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("defaults existing and new users to an empty interests array", async () => {
    assert.deepEqual(new User().interests, []);
    const { body } = await supertest(app).get("/me").expect(200);
    assert.deepEqual(body.data.interests, []);
  });

  it("updates interests and returns them from PATCH and GET", async () => {
    const patched = await supertest(app).patch("/me").send({ interests: [" Portrait ", "Events"] }).expect(200);
    assert.deepEqual(patched.body.data.interests, ["Portrait", "Events"]);
    assert.deepEqual(document.interests, ["Portrait", "Events"]);
    const fetched = await supertest(app).get("/me").expect(200);
    assert.deepEqual(fetched.body.data.interests, ["Portrait", "Events"]);
    const cleared = await supertest(app).patch("/me").send({ interests: [] }).expect(200);
    assert.deepEqual(cleared.body.data.interests, []);
  });

  it("preserves interests when other profile fields are updated", async () => {
    document.interests = ["Events"];
    const { body } = await supertest(app).patch("/me").send({ name: "Updated" }).expect(200);
    assert.deepEqual(body.data.interests, ["Events"]);
    assert.deepEqual(document.interests, ["Events"]);
  });

  it("rejects malformed interests without updating the user", async () => {
    for (const interests of [null, "Events", [4], [""], ["  "]]) {
      await supertest(app).patch("/me").send({ interests }).expect(400);
    }
    assert.equal(updates, 0);
  });
});
