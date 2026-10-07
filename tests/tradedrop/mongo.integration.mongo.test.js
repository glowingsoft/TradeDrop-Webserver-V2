/**
 * TradeDrop Mongo integration — AUTH_REPOSITORY=mongo + MONGO_URI_TEST.
 */
const assert = require("assert");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

// Fail clearly if test URI missing (do not silently skip, do not use prod alone)
if (!process.env.MONGO_URI_TEST) {
  // Allow deriving a safe local test DB from BASE_URL host when clearly local
  const base = process.env.BASE_URL || "";
  if (base.includes("127.0.0.1") || base.includes("localhost")) {
    process.env.MONGO_URI_TEST = "mongodb://127.0.0.1:27017/tradedrop-test";
  }
}

process.env.AUTH_REPOSITORY = "mongo";
process.env.DEBUG_OTP = "true";
process.env.NODE_ENV = process.env.NODE_ENV || "dev";

const {
  connectTestMongo,
  clearTradeDropCollections,
  disconnectTestMongo,
  requireMongoUriTest,
} = require("../helpers/mongo");

describe("TradeDrop Mongo integration", function () {
  this.timeout(60000);

  let request;
  let app;
  let catalogRepo;

  before(async function () {
    requireMongoUriTest();
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — load from .env.dev");
    }
    await connectTestMongo();

    // Require app AFTER AUTH_REPOSITORY=mongo is set
    const { createTestApp } = require("../helpers/createApp");
    catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");
    app = createTestApp();
    request = require("supertest");
  });

  beforeEach(async function () {
    await clearTradeDropCollections();
    await catalogRepo.listCategories(); // seed categories/cms
  });

  after(async function () {
    await clearTradeDropCollections();
    await disconnectTestMongo();
  });

  async function registerVerifiedOnboarded(overrides = {}) {
    const email = overrides.email || `mongo_${Date.now()}@tradedrop.local`;
    const handle = overrides.handle || `m_${Math.random().toString(36).slice(2, 10)}`;
    const password = "password123";

    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email,
        password,
        name: overrides.name || "Mongo User",
        handle,
      });
    assert.strictEqual(reg.status, 201, reg.body.message);
    assert.ok(reg.body.data.debugOtp);

    await request(app).post("/api/v1/auth/otp/verify").send({
      email,
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });

    const login = await request(app).post("/api/v1/auth/login").send({ email, password });
    assert.strictEqual(login.status, 200, login.body.message);
    const token = login.body.data.token;

    const cats = await request(app).get("/api/v1/categories");
    assert.ok(cats.body.data.length >= 1);
    const craftId =
      overrides.craftId || cats.body.data.find((c) => c.slug === "photographer")?._id || cats.body.data[0]._id;

    const onboard = await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Need collab",
        needCategoryId: craftId,
        offerText: "Offer skill",
        offerCategoryId: craftId,
        areaLabel: overrides.areaLabel || "Soho",
        timingChip: "this_week",
      });
    assert.strictEqual(onboard.status, 200, onboard.body.message);

    // set geo for radar
    await request(app)
      .patch("/api/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lat: overrides.lat ?? 40.7234567,
        lng: overrides.lng ?? -74.0023456,
        areaLabel: overrides.areaLabel || "Soho",
      });

    return { token, email, handle, craftId, password };
  }

  it("register + otp + onboarding against Mongo", async function () {
    const { token, handle } = await registerVerifiedOnboarded({
      email: "mongo_reg@tradedrop.local",
      handle: "mongo_reg",
    });
    const me = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.data.basicInfo.handle, "mongo_reg");
    assert.strictEqual(me.body.data.onboarding, true);
    assert.ok(handle);
  });

  it("unique handle → 409/400 on conflict", async function () {
    await registerVerifiedOnboarded({
      email: "h1@tradedrop.local",
      handle: "unique_h",
    });
    const dup = await request(app).post("/api/v1/auth/register").send({
      email: "h2@tradedrop.local",
      password: "password123",
      handle: "unique_h",
    });
    assert.ok(dup.status === 400 || dup.status === 409, dup.body.message);
  });

  it("create drop + tap-in + accept + complete + review", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "own_m@tradedrop.local",
      handle: "own_mongo",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "app_m@tradedrop.local",
      handle: "app_mongo",
      lat: 40.7241111,
      lng: -74.0012222,
    });

    const drop = await request(app).post("/api/v1/drops").set("Authorization", `Bearer ${owner.token}`).send({
      needText: "Need model",
      offerText: "Offer photos",
      needCategoryId: owner.craftId,
      offerCategoryId: owner.craftId,
      timingChip: "asap",
      areaLabel: "Brooklyn",
    });
    assert.strictEqual(drop.status, 201, drop.body.message);

    const tap = await request(app)
      .post(`/api/v1/drops/${drop.body.data._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "I can shoot", availability: "Sat" });
    assert.strictEqual(tap.status, 201, tap.body.message);

    const dup = await request(app)
      .post(`/api/v1/drops/${drop.body.data._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "again", availability: "Sun" });
    assert.strictEqual(dup.status, 409);

    const accepted = await request(app)
      .post(`/api/v1/tap-ins/${tap.body.data._id}/accept`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(accepted.status, 200, accepted.body.message);
    const tradeId = accepted.body.data.trade._id;
    assert.ok(tradeId);

    const proposed = await request(app)
      .post(`/api/v1/trades/${tradeId}/complete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    assert.strictEqual(proposed.status, 200);

    const confirmed = await request(app)
      .post(`/api/v1/trades/${tradeId}/complete/confirm`)
      .set("Authorization", `Bearer ${applicant.token}`);
    assert.strictEqual(confirmed.status, 200);
    assert.strictEqual(confirmed.body.data.status, "completed");

    const review = await request(app)
      .post(`/api/v1/trades/${tradeId}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ stars: 5, body: "Great" });
    assert.strictEqual(review.status, 201, review.body.message);
  });

  it("radar does not leak raw coords or email", async function () {
    await registerVerifiedOnboarded({
      email: "rad1@tradedrop.local",
      handle: "rad_maya",
      lat: 40.7234567,
      lng: -74.0023456,
    });
    await registerVerifiedOnboarded({
      email: "rad2@tradedrop.local",
      handle: "rad_jordan",
      areaLabel: "Brooklyn",
      lat: 40.6781234,
      lng: -73.9445678,
      craftId: (await request(app).get("/api/v1/categories")).body.data.find((c) => c.slug === "hairdresser")?._id,
    });

    const res = await request(app).get("/api/v1/radar");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 2);

    for (const pin of res.body.data) {
      assert.strictEqual(pin.email, undefined);
      assert.strictEqual(pin.passwordHash, undefined);
      if (pin.lat != null) {
        const decimals = String(pin.lat).split(".")[1] || "";
        assert.ok(decimals.length <= 3, `lat not rounded: ${pin.lat}`);
      }
      if (pin.lng != null) {
        const decimals = String(pin.lng).split(".")[1] || "";
        assert.ok(decimals.length <= 3, `lng not rounded: ${pin.lng}`);
      }
      // must not equal raw high-precision seed for maya
      if (pin.handle === "rad_maya") {
        assert.notStrictEqual(pin.lat, 40.7234567);
        assert.strictEqual(pin.lat, 40.723);
      }
    }
  });
});
