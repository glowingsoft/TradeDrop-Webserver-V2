const assert = require("assert");
const path = require("path");
const request = require("supertest");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

const {
  createTestApp,
  resetAuthStore,
} = require("../helpers/createApp");
const catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");
const {
  CATEGORY_SEED,
  CMS_SEED,
} = require("../../backend/roles/user/catalog/memoryCatalogStore");

describe("TradeDrop Slice 2 — Catalog / CMS mock (memory)", function () {
  this.timeout(10000);

  let app;

  before(function () {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — expected from .env.dev");
    }
    process.env.AUTH_REPOSITORY = "memory";
    app = createTestApp();
  });

  beforeEach(function () {
    resetAuthStore();
    catalogRepo.reset();
  });

  it("TC-017 GET /categories returns seeded launch categories (guest, no token)", async function () {
    const res = await request(app).get("/api/v1/categories");
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data.length, CATEGORY_SEED.length);

    const slugs = res.body.data.map((c) => c.slug).sort();
    const expected = CATEGORY_SEED.map((c) => c.slug).sort();
    assert.deepStrictEqual(slugs, expected);

    for (const cat of res.body.data) {
      assert.ok(cat._id);
      assert.ok(cat.name);
      assert.ok(cat.chipGroup);
      assert.strictEqual(cat.active, true);
    }
  });

  it("TC-017 categories are ordered by sortOrder", async function () {
    const res = await request(app).get("/api/v1/categories");
    assert.strictEqual(res.status, 200);
    const orders = res.body.data.map((c) => c.sortOrder);
    const sorted = [...orders].sort((a, b) => a - b);
    assert.deepStrictEqual(orders, sorted);
  });

  for (const page of CMS_SEED) {
    it(`TC-018 GET /cms/${page.slug} happy path (guest)`, async function () {
      const res = await request(app).get(`/api/v1/cms/${page.slug}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message);
      assert.strictEqual(res.body.data.slug, page.slug);
      assert.strictEqual(res.body.data.title, page.title);
      assert.ok(res.body.data.bodyMarkdown);
    });
  }

  it("TC-018 unknown cms slug returns 404", async function () {
    const res = await request(app).get("/api/v1/cms/not-a-real-page");
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.message);
  });

  it("guest can call categories and cms without Authorization header", async function () {
    const cats = await request(app).get("/api/v1/categories");
    const cms = await request(app).get("/api/v1/cms/terms");
    assert.strictEqual(cats.status, 200);
    assert.strictEqual(cms.status, 200);
    assert.strictEqual(cats.headers["www-authenticate"], undefined);
  });
});
