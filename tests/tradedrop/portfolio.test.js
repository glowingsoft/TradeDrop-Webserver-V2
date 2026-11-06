const assert = require("node:assert/strict");
const path = require("node:path");
const moduleAlias = require("module-alias");
const express = require("express");
const supertest = require("supertest");

for (const [alias, target] of Object.entries(require("../../aliasConfig/pathAliases.config"))) {
  moduleAlias.addAlias(alias, path.resolve(__dirname, "../..", target));
}

const { User } = require("../../backend/models/UserModel");
const repo = require("../../backend/roles/user/auth/authRepository");
const service = require("../../backend/roles/user/me/profileService");
const controller = require("../../backend/roles/user/me/profileController");
const { portfolioItemView } = require("../../backend/helperUtils/portfolioUtil");

describe("portfolio image editing", () => {
  const originalFind = repo.findById;
  const originalUpdate = User.findOneAndUpdate;
  let user;
  let lastUpdate;

  beforeEach(() => {
    user = { _id: "user", portfolioItems: [{ _id: "legacy", imageUrl: "old.jpg", title: "Old" }] };
    repo.findById = async () => user;
    User.findOneAndUpdate = (filter, update) => ({
      lean: async () => {
        lastUpdate = { filter, update };
        if (update.$push) user.portfolioItems.push(update.$push.portfolioItems);
        if (update.$set) {
          const item = user.portfolioItems.find((entry) => entry._id === filter["portfolioItems._id"]);
          if (!item) return null;
          for (const [key, value] of Object.entries(update.$set)) item[key.split(".").pop()] = value;
        }
        if (update.$pull) {
          const index = user.portfolioItems.findIndex((entry) => entry._id === filter["portfolioItems._id"]);
          if (index < 0) return null;
          user.portfolioItems.splice(index, 1);
        }
        return user;
      },
    });
  });

  afterEach(() => {
    repo.findById = originalFind;
    User.findOneAndUpdate = originalUpdate;
  });

  it("creates items with six images and no legacy fields", async () => {
    const images = Array.from({ length: 6 }, (_, index) => ` image${index}.jpg `);
    const result = await service.addPortfolioItem("user", { title: "New", imageUrls: images });
    assert.equal(result.item.imageUrls.length, 6);
    assert.equal(result.item.imageUrl, undefined);
    assert.equal(result.item.tags, undefined);
    assert.equal(result.item.imageUrls[5], "image5.jpg");
    assert.deepEqual(result.profile.portfolioItems[1].imageUrls, result.item.imageUrls);
  });

  it("represents stored legacy images as arrays without exposing obsolete fields", async () => {
    const item = portfolioItemView({ ...user.portfolioItems[0], tags: ["old"] });
    assert.deepEqual(item.imageUrls, ["old.jpg"]);
    assert.equal(item.imageUrl, undefined);
    assert.equal(item.tags, undefined);
    const profile = await service.patchPortfolioItem("user", "legacy", { title: "Updated" });
    assert.deepEqual(profile.portfolioItems[0].imageUrls, ["old.jpg"]);
    assert.equal(profile.portfolioItems[0].imageUrl, undefined);
  });

  it("preserves legacy images when a stored user is hydrated", () => {
    const stored = User.hydrate({
      _id: "507f1f77bcf86cd799439011",
      email: "legacy@example.com",
      portfolioItems: [{ _id: "legacy", imageUrl: "old.jpg", tags: ["old"] }],
    }).toObject();
    const item = portfolioItemView(stored.portfolioItems[0]);
    assert.deepEqual(item.imageUrls, ["old.jpg"]);
    assert.equal(item.imageUrl, undefined);
    assert.equal(item.tags, undefined);
  });

  it("replaces, reorders and removes images via a partial update", async () => {
    const profile = await service.patchPortfolioItem("user", "legacy", {
      imageUrls: ["new.jpg", "old.jpg"],
      title: "Updated",
    });
    assert.deepEqual(profile.portfolioItems[0].imageUrls, ["new.jpg", "old.jpg"]);
    assert.equal(profile.portfolioItems[0].imageUrl, undefined);
    assert.equal(lastUpdate.update.$set["portfolioItems.$.title"], "Updated");
    await service.patchPortfolioItem("user", "legacy", { imageUrls: ["last.jpg"] });
    assert.deepEqual(user.portfolioItems[0].imageUrls, ["last.jpg"]);
  });

  it("rejects removed imageUrl and tags inputs", async () => {
    for (const body of [{ imageUrl: "old.jpg" }, { imageUrls: ["a.jpg"], tags: ["old"] }]) {
      await assert.rejects(service.addPortfolioItem("user", body), { statusCode: 400 });
      await assert.rejects(service.patchPortfolioItem("user", "legacy", body), { statusCode: 400 });
    }
  });

  it("rejects empty, oversized and invalid image arrays", async () => {
    for (const imageUrls of [[], Array(7).fill("a.jpg"), [" "], ["a.jpg", 2], "a.jpg"]) {
      await assert.rejects(service.addPortfolioItem("user", { title: "New", imageUrls }), { statusCode: 400 });
      await assert.rejects(service.patchPortfolioItem("user", "legacy", { imageUrls }), { statusCode: 400 });
    }
    assert.equal(user.portfolioItems[0].imageUrl, "old.jpg");
  });

  it("deletes the selected item atomically and reports missing items", async () => {
    const profile = await service.deletePortfolioItem("user", "legacy");
    assert.deepEqual(profile.portfolioItems, []);
    assert.deepEqual(lastUpdate.update.$pull, { portfolioItems: { _id: "legacy" } });
    await assert.rejects(service.deletePortfolioItem("user", "missing"), { statusCode: 404 });
    await assert.rejects(service.patchPortfolioItem("user", "missing", { title: "New" }), { statusCode: 404 });
  });

  it("accepts image arrays through create and edit controllers", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { _id: "user" };
      req.__ = (key) => key;
      next();
    });
    app.post("/portfolio", controller.postPortfolio);
    app.patch("/portfolio/:id", controller.patchPortfolio);
    app.delete("/portfolio/:id", controller.deletePortfolio);
    const created = await supertest(app).post("/portfolio").send({ title: "New", imageUrls: ["a.jpg", "b.jpg"] }).expect(201);
    const itemId = created.body.data.item._id;
    const updated = await supertest(app).patch(`/portfolio/${itemId}`).send({ imageUrls: ["b.jpg"] }).expect(200);
    assert.deepEqual(updated.body.data.portfolioItems[1].imageUrls, ["b.jpg"]);
    await supertest(app).patch(`/portfolio/${itemId}`).send({ imageUrls: [] }).expect(400);
    await supertest(app).delete(`/portfolio/${itemId}`).expect(200);
  });
});
