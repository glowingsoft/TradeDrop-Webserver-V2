const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("../helpers/registerAliases");

const Category = require("../../backend/models/Category");
const Area = require("../../backend/models/Area");
const AppSettings = require("../../backend/models/AppSettings");
const Conversation = require("../../backend/commonModules/chatModule/models/Conversation");
const repo = require("../../backend/roles/user/catalog/mongoCatalogRepository");
const service = require("../../backend/roles/user/catalog/catalogService");

describe("category interests", () => {
  const originals = [];
  const categoryId = new mongoose.Types.ObjectId();

  function replace(target, method, replacement) {
    originals.push([target, method, target[method]]);
    target[method] = replacement;
  }

  afterEach(() => {
    for (const [target, method, original] of originals.reverse()) target[method] = original;
    originals.length = 0;
  });

  it("creates categories without a chip group or conversation", async () => {
    replace(repo, "findCategoryBySlug", async () => null);
    replace(repo, "createCategory", async (data) => ({ _id: categoryId, ...data }));
    replace(Conversation, "create", () => { throw new Error("unexpected group creation"); });
    replace(Conversation, "findOne", () => { throw new Error("unexpected group lookup"); });
    const result = await service.createOrUpdateCategory({
      slug: " Photo ",
      name: " Photo ",
      interests: [" Portrait ", "Events"],
    });
    assert.equal(result.category.slug, "photo");
    assert.deepEqual(result.category.interests, ["Portrait", "Events"]);
    assert.equal("chipGroup" in result.category, false);
    assert.equal("conversation" in result, false);
  });

  it("preserves interests when an upsert omits them and permits clearing via update", async () => {
    replace(repo, "findCategoryBySlug", async () => ({ _id: categoryId, slug: "photo" }));
    replace(repo, "findCategoryById", async () => ({ _id: categoryId, slug: "photo" }));
    let stored = { _id: categoryId, slug: "photo", interests: ["Portrait"] };
    replace(repo, "updateCategory", async (_id, patch) => {
      stored = { ...stored, ...patch };
      return stored;
    });
    const upsert = await service.createOrUpdateCategory({ slug: "photo", name: "Photo" });
    assert.deepEqual(upsert.category.interests, ["Portrait"]);
    const updated = await service.updateCategory(String(categoryId), { interests: [] });
    assert.deepEqual(updated.interests, []);
  });

  it("rejects malformed interests on both write paths", async () => {
    replace(repo, "findCategoryById", async () => ({ _id: categoryId, slug: "photo" }));
    for (const interests of ["portrait", [1], [""], null]) {
      await assert.rejects(service.createOrUpdateCategory({ slug: "photo", name: "Photo", interests }),
        (error) => error.statusCode === 400 && error.translationKey === "category_interests_invalid");
      await assert.rejects(service.updateCategory(String(categoryId), { interests }),
        (error) => error.statusCode === 400 && error.translationKey === "category_interests_invalid");
    }
  });

  it("stores and serializes interests and defaults existing categories to an empty array", async () => {
    let saved;
    replace(Category, "create", async (data) => {
      saved = data;
      return { toObject: () => ({ _id: categoryId, ...data }) };
    });
    const created = await repo.createCategory({ slug: "photo", name: "Photo", interests: ["Portrait"] });
    assert.deepEqual(saved.interests, ["Portrait"]);
    assert.deepEqual(created.interests, ["Portrait"]);
    assert.deepEqual(repo.toPublic({ _id: categoryId, chipGroup: "photo" }).interests, []);
    assert.equal("chipGroup" in repo.toPublic({ _id: categoryId, chipGroup: "photo" }), false);
    assert.equal(Category.schema.path("chipGroup"), undefined);
    assert.deepEqual(new Category({ slug: "photo", name: "Photo" }).interests, []);
  });

  it("projects interests and does not apply chip group filters in paginated lists", async () => {
    let pipeline;
    replace(Category, "aggregate", async (value) => {
      pipeline = value;
      return [{ categories: [], total: [], activeStats: [] }];
    });
    await repo.getCategories({ req: { query: { chipGroup: "photo" } }, filter: { status: "active" } });
    const facet = pipeline[0].$facet;
    assert.deepEqual(facet.categories[0].$match, { status: "active" });
    const projection = facet.categories.find((stage) => stage.$project).$project;
    assert.deepEqual(projection.interests, { $ifNull: ["$interests", []] });
    assert.equal(projection.chipGroup, undefined);
  });

  it("seeds categories without creating conversation groups", async () => {
    replace(Category, "countDocuments", async () => 0);
    replace(Category, "insertMany", async (categories) => {
      assert.ok(categories.length > 0);
      assert.ok(categories.every((category) => !("chipGroup" in category)));
    });
    replace(Conversation, "countDocuments", () => { throw new Error("unexpected group lookup"); });
    replace(Conversation, "insertMany", () => { throw new Error("unexpected group creation"); });
    replace(Area, "updateOne", async () => {});
    replace(AppSettings, "updateOne", async () => {});
    await repo.ensureSeed();
  });
});
