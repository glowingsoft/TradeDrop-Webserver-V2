const assert = require("assert");
const path = require("path");
const request = require("supertest");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

const {
  createTestApp,
  resetAuthStore,
  resetDropStore,
  authRepo,
} = require("../helpers/createApp");
const catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");

describe("TradeDrop Slice 8 — Radar mock (memory)", function () {
  this.timeout(25000);

  let app;

  before(function () {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — expected from .env.dev");
    }
    process.env.AUTH_REPOSITORY = "memory";
    process.env.DEBUG_OTP = "true";
    app = createTestApp();
  });

  beforeEach(async function () {
    resetAuthStore();
    catalogRepo.reset();
    await resetDropStore();
  });

  async function loginSeed(email, password = "password123") {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    assert.strictEqual(login.status, 200, login.body.message);
    return login.body.data.token;
  }

  async function registerVerifiedOnboarded(overrides = {}) {
    const email = overrides.email || `rad_${Date.now()}@tradedrop.local`;
    const handle =
      overrides.handle || `r_${Math.random().toString(36).slice(2, 10)}`;
    const password = "password123";

    const reg = await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      name: overrides.name || "Radar User",
      handle,
    });
    assert.strictEqual(reg.status, 201, reg.body.message);

    await request(app).post("/api/v1/auth/otp/verify").send({
      email,
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    const token = login.body.data.token;
    const userId = login.body.data.user?._id;

    const cats = await request(app).get("/api/v1/categories");
    const craftId =
      overrides.craftId ||
      cats.body.data.find((c) => c.chipGroup === "makeup")?._id ||
      cats.body.data[0]._id;

    await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Need",
        needCategoryId: craftId,
        offerText: "Offer",
        offerCategoryId: craftId,
        areaLabel: overrides.areaLabel || "Soho",
        timingChip: "this_week",
      });

    if (overrides.lat !== undefined || overrides.lng !== undefined) {
      authRepo.update(userId, {
        lat: overrides.lat ?? null,
        lng: overrides.lng ?? null,
      });
    }

    return { token, email, handle, craftId, userId };
  }

  it("guest GET returns array", async function () {
    const res = await request(app).get("/api/v1/radar");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 2);
    const handles = res.body.data.map((p) => p.handle);
    assert.ok(handles.includes("maya_lens"));
    assert.ok(handles.includes("cutbyjordan"));
  });

  it("pins omit email", async function () {
    const res = await request(app).get("/api/v1/radar");
    assert.strictEqual(res.status, 200);
    for (const pin of res.body.data) {
      assert.strictEqual(pin.email, undefined);
      assert.strictEqual(pin.passwordHash, undefined);
      assert.strictEqual(pin.phoneNumber, undefined);
    }
  });

  it("other users’ lat/lng rounded to ~3 decimals", async function () {
    const maya = authRepo.findByHandle("maya_lens");
    assert.ok(maya.lat);
    assert.ok(String(maya.lat).split(".")[1]?.length > 3);

    const res = await request(app).get("/api/v1/radar");
    const pin = res.body.data.find((p) => p.handle === "maya_lens");
    assert.ok(pin);
    assert.strictEqual(pin.lat, Math.round(maya.lat * 1000) / 1000);
    assert.strictEqual(pin.lng, Math.round(maya.lng * 1000) / 1000);
    assert.ok(pin.lat !== maya.lat || pin.lng !== maya.lng);
  });

  it("self excluded when Authorization present", async function () {
    const token = await loginSeed("maya@tradedrop.local");
    const res = await request(app)
      .get("/api/v1/radar")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.data.some((p) => p.handle === "maya_lens"));
    assert.ok(res.body.data.some((p) => p.handle === "cutbyjordan"));
  });

  it("openToTrade false or radarVisible false excluded", async function () {
    const token = await loginSeed("maya@tradedrop.local");

    await request(app)
      .patch("/api/v1/me/privacy")
      .set("Authorization", `Bearer ${token}`)
      .send({ openToTrade: false });

    let res = await request(app).get("/api/v1/radar");
    assert.ok(!res.body.data.some((p) => p.handle === "maya_lens"));

    await request(app)
      .patch("/api/v1/me/privacy")
      .set("Authorization", `Bearer ${token}`)
      .send({ openToTrade: true, radarVisible: false });

    res = await request(app).get("/api/v1/radar");
    assert.ok(!res.body.data.some((p) => p.handle === "maya_lens"));
  });

  it("category filter", async function () {
    const photo = await request(app)
      .get("/api/v1/radar")
      .query({ category: "photo" });
    assert.strictEqual(photo.status, 200);
    assert.ok(photo.body.data.some((p) => p.handle === "maya_lens"));
    assert.ok(!photo.body.data.some((p) => p.handle === "cutbyjordan"));

    const hair = await request(app)
      .get("/api/v1/radar")
      .query({ category: "hair" });
    assert.strictEqual(hair.status, 200);
    assert.ok(hair.body.data.some((p) => p.handle === "cutbyjordan"));
    assert.ok(!hair.body.data.some((p) => p.handle === "maya_lens"));
  });

  it("area filter", async function () {
    const soho = await request(app)
      .get("/api/v1/radar")
      .query({ area: "Soho" });
    assert.strictEqual(soho.status, 200);
    assert.ok(soho.body.data.some((p) => p.handle === "maya_lens"));
    assert.ok(!soho.body.data.some((p) => p.handle === "cutbyjordan"));

    const brooklyn = await request(app)
      .get("/api/v1/radar")
      .query({ area: "Brooklyn" });
    assert.ok(brooklyn.body.data.some((p) => p.handle === "cutbyjordan"));
    assert.ok(!brooklyn.body.data.some((p) => p.handle === "maya_lens"));
  });
});
