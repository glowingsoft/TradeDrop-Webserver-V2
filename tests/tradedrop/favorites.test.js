const assert = require("node:assert/strict");
const path = require("node:path");
const moduleAlias = require("module-alias");
const mongoose = require("mongoose");
const express = require("express");
const supertest = require("supertest");

for (const [alias, target] of Object.entries(require("../../aliasConfig/pathAliases.config"))) {
  moduleAlias.addAlias(alias, path.resolve(__dirname, "../..", target));
}

const { Favorites } = require("../../backend/commonModules/favorites/Favorite");
const Category = require("../../backend/models/Category");
const { getUserFavorites } = require("../../backend/roles/user/favorites/favoriteController");

describe("favorite users", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  const craftId = new mongoose.Types.ObjectId();
  const createdAt = new Date("2025-01-01T00:00:00Z");
  const original = {};
  let state;
  let app;

  before(() => {
    original.find = Favorites.find;
    original.countDocuments = Favorites.countDocuments;
    original.baseUrl = process.env.S3_BASE_URL;
    process.env.S3_BASE_URL = "https://images.example.com/";
    app = express();
    app.use((req, res, next) => {
      req.user = { _id: viewerId };
      req.__ = (key) => key;
      next();
    });
    app.get("/favorites", getUserFavorites);
  });

  beforeEach(() => {
    state = {
      items: [
        {
          target: {
            _id: targetId,
            name: "Person",
            handle: "person",
            profileIcon: "avatar.png",
            crafts: [
              { _id: craftId, name: "Woodwork", image: "craft.png" },
              { _id: new mongoose.Types.ObjectId(), name: "Art", image: "https://cdn.example.com/art.png" },
              { _id: new mongoose.Types.ObjectId(), name: "Other", image: "" },
              null,
            ],
          },
          createdAt,
        },
        { target: null, createdAt },
        { target: { _id: new mongoose.Types.ObjectId(), name: "No crafts" }, createdAt },
      ],
    };
    Favorites.find = (filter) => {
      state.filter = filter;
      const query = {};
      for (const method of ["sort", "skip", "limit", "populate"]) {
        query[method] = (value) => {
          state[method] = value;
          return query;
        };
      }
      query.lean = async () => state.items;
      return query;
    };
    Favorites.countDocuments = async (filter) => {
      state.countFilter = filter;
      return 3;
    };
  });

  after(() => {
    Favorites.find = original.find;
    Favorites.countDocuments = original.countDocuments;
    if (original.baseUrl === undefined) delete process.env.S3_BASE_URL;
    else process.env.S3_BASE_URL = original.baseUrl;
  });

  it("populates crafts and returns full image URLs without changing favorite fields", async () => {
    const { body } = await supertest(app).get("/favorites?page=2&limit=2").expect(200);
    assert.deepEqual(state.filter, { user: viewerId });
    assert.deepEqual(state.countFilter, state.filter);
    assert.deepEqual(state.sort, { createdAt: -1 });
    assert.equal(state.skip, 2);
    assert.equal(state.limit, 2);
    assert.deepEqual(state.populate, {
      path: "target",
      select: "name handle profileIcon crafts",
      populate: { path: "crafts", model: Category, select: "name image" },
    });
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0]._id, String(targetId));
    assert.equal(body.data[0].name, "Person");
    assert.equal(body.data[0].handle, "person");
    assert.equal(body.data[0].profileIcon, "https://images.example.com/avatar.png");
    assert.equal(body.data[0].favoritedAt, createdAt.toISOString());
    assert.deepEqual(body.data[0].crafts, [
      { _id: String(craftId), name: "Woodwork", image: "https://images.example.com/craft.png" },
      { _id: String(state.items[0].target.crafts[1]._id), name: "Art", image: "https://cdn.example.com/art.png" },
      { _id: String(state.items[0].target.crafts[2]._id), name: "Other", image: "https://images.example.com/noimage.png" },
    ]);
    assert.deepEqual(body.data[1].crafts, []);
    assert.deepEqual(body.meta, { currentPage: 2, totalPages: 2, totalRecords: 3, limit: 2 });
  });

  it("returns an error when populating favorites fails", async () => {
    Favorites.find = () => {
      throw new Error("favorites query failed");
    };
    await supertest(app).get("/favorites").expect(500);
  });
});
