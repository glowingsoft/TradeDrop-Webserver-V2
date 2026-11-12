const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const supertest = require("supertest");

require("../helpers/registerAliases");

const Category = require("../../backend/models/Category");
const { User } = require("../../backend/models/UserModel");
const controller = require("../../backend/roles/user/catalog/catalogController");
const routes = require("../../backend/roles/user/catalog/catalogRoutes");

describe("other category interests", () => {
  const userId = new mongoose.Types.ObjectId();
  const craftId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const originals = [];
  let user;
  let app;
  let pipeline;

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }

  before(() => {
    replace(User, "findById", () => ({ select: () => ({ lean: async () => user }) }));
    replace(Category, "aggregate", async (stages) => {
      pipeline = stages;
      const { categories, total, activeStats } = stages[0].$facet;
      assert.deepEqual(categories[0].$match.status, "active");
      assert.deepEqual(total[0].$match, categories[0].$match);
      assert.deepEqual(activeStats[0].$match, categories[0].$match);
      return [{
        categories: [{ _id: otherId, name: "Design", interests: ["Logos", "Portraits"] }],
        total: [{ count: 1 }],
        activeStats: [{ _id: "active", count: 1 }],
      }];
    });
    app = express();
    app.use((req, res, next) => { req.user = { _id: userId }; req.__ = (key) => key; next(); });
    app.get("/categories/interests", controller.getOtherCategoryInterests);
  });

  beforeEach(() => {
    user = { _id: userId, crafts: [craftId] };
    pipeline = null;
  });

  after(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
  });

  it("uses authentication and excludes stored craft ObjectIds before pagination", async () => {
    const secured = express();
    secured.use((req, res, next) => { req.__ = (key) => key; next(); });
    secured.use(routes);
    await supertest(secured).get("/categories/interests").expect(401);

    const { body } = await supertest(app).get("/categories/interests?page=1&limit=1&status=inactive").expect(200);
    assert.deepEqual(body.data, [{ _id: String(otherId), name: "Design", interests: ["Logos", "Portraits"] }]);
    assert.equal(body.meta.totalRecords, 1);
    const facet = pipeline[0].$facet;
    assert.deepEqual(facet.categories[0].$match._id, { $nin: [craftId] });
    assert.equal(facet.categories[3].$limit, 1);
    assert.deepEqual(facet.categories[4].$project.interests, { $ifNull: ["$interests", []] });
  });

  it("does not exclude categories for users without crafts", async () => {
    user.crafts = [];
    await supertest(app).get("/categories/interests").expect(200);
    assert.deepEqual(pipeline[0].$facet.categories[0].$match._id, { $nin: [] });
  });

  it("rejects unavailable accounts", async () => {
    for (const unavailable of [null, { _id: userId, deletedAt: new Date() }]) {
      user = unavailable;
      await supertest(app).get("/categories/interests").expect(401);
      assert.equal(pipeline, null);
    }
  });
});
