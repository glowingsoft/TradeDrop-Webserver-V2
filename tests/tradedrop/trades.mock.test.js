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
  resetTapInStore,
} = require("../helpers/createApp");
const catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");
const tapInRepo = require("../../backend/roles/user/tapIns/tapInRepository");

describe("TradeDrop Slice 7 — Trades complete + reviews mock (memory)", function () {
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
    resetTapInStore();
    await resetDropStore();
  });

  async function registerVerifiedOnboarded(overrides = {}) {
    const email = overrides.email || `u_${Date.now()}@tradedrop.local`;
    const handle =
      overrides.handle || `h_${Math.random().toString(36).slice(2, 10)}`;
    const password = "password123";

    const reg = await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      name: overrides.name || "User",
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

    const cats = await request(app).get("/api/v1/categories");
    const craftId = cats.body.data[0]._id;
    await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Need",
        needCategoryId: craftId,
        offerText: "Offer",
        offerCategoryId: craftId,
        areaLabel: "Soho",
        timingChip: "this_week",
      });

    return { token, email, handle, craftId, userId: login.body.data.user?._id };
  }

  async function createAcceptedTrade() {
    const owner = await registerVerifiedOnboarded({
      email: "tr_owner@tradedrop.local",
      handle: "tr_owner",
      name: "Owner",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "tr_app@tradedrop.local",
      handle: "tr_app",
      name: "Applicant",
    });

    const drop = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        needText: "Need a collaborator",
        offerText: "Offer my skill",
        needCategoryId: owner.craftId,
        offerCategoryId: owner.craftId,
        timingChip: "asap",
        areaLabel: "Brooklyn",
      });
    assert.strictEqual(drop.status, 201, drop.body.message);

    const tap = await request(app)
      .post(`/api/v1/drops/${drop.body.data._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "I can help", availability: "weekend" });
    assert.strictEqual(tap.status, 201, tap.body.message);

    const accepted = await request(app)
      .post(`/api/v1/tap-ins/${tap.body.data._id}/accept`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(accepted.status, 200, accepted.body.message);

    return {
      owner,
      applicant,
      drop: drop.body.data,
      trade: accepted.body.data.trade,
      tapIn: accepted.body.data.tapIn,
    };
  }

  it("accept tap-in (existing) → trade exists", async function () {
    const { trade } = await createAcceptedTrade();
    assert.ok(trade._id);
    assert.strictEqual(trade.status, "in_progress");
    const stored = tapInRepo.findTradeById(trade._id);
    assert.ok(stored);
    assert.strictEqual(stored.status, "in_progress");
  });

  it("propose + confirm → completed", async function () {
    const { owner, applicant, trade } = await createAcceptedTrade();

    const proposed = await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    assert.strictEqual(proposed.status, 200, proposed.body.message);
    assert.strictEqual(proposed.body.data.status, "completion_proposed");
    assert.ok(proposed.body.data.completionProposedBy);

    const confirmed = await request(app)
      .post(`/api/v1/trades/${trade._id}/complete/confirm`)
      .set("Authorization", `Bearer ${applicant.token}`);
    assert.strictEqual(confirmed.status, 200, confirmed.body.message);
    assert.strictEqual(confirmed.body.data.status, "completed");
    assert.ok(confirmed.body.data.completedAt);
  });

  it("proposer cannot confirm their own proposal", async function () {
    const { owner, trade } = await createAcceptedTrade();

    await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});

    const res = await request(app)
      .post(`/api/v1/trades/${trade._id}/complete/confirm`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(res.status, 403);
  });

  it("reject returns to in_progress", async function () {
    const { owner, applicant, trade } = await createAcceptedTrade();

    await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});

    const rejected = await request(app)
      .post(`/api/v1/trades/${trade._id}/complete/reject`)
      .set("Authorization", `Bearer ${applicant.token}`);
    assert.strictEqual(rejected.status, 200, rejected.body.message);
    assert.strictEqual(rejected.body.data.status, "in_progress");
    assert.strictEqual(rejected.body.data.completionProposedBy, null);
  });

  it("review before complete → 403", async function () {
    const { owner, trade } = await createAcceptedTrade();

    const res = await request(app)
      .post(`/api/v1/trades/${trade._id}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ stars: 5, body: "too early" });
    assert.strictEqual(res.status, 403);
  });

  it("review after complete happy path", async function () {
    const { owner, applicant, trade } = await createAcceptedTrade();

    await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .post(`/api/v1/trades/${trade._id}/complete/confirm`)
      .set("Authorization", `Bearer ${applicant.token}`);

    const review = await request(app)
      .post(`/api/v1/trades/${trade._id}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ stars: 5, body: "Great collab" });
    assert.strictEqual(review.status, 201, review.body.message);
    assert.strictEqual(review.body.data.stars, 5);
    assert.strictEqual(review.body.data.body, "Great collab");
  });

  it("second review same user → 409", async function () {
    const { owner, applicant, trade } = await createAcceptedTrade();

    await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .post(`/api/v1/trades/${trade._id}/complete/confirm`)
      .set("Authorization", `Bearer ${applicant.token}`);

    const first = await request(app)
      .post(`/api/v1/trades/${trade._id}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ stars: 4 });
    assert.strictEqual(first.status, 201);

    const dup = await request(app)
      .post(`/api/v1/trades/${trade._id}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ stars: 3 });
    assert.strictEqual(dup.status, 409);
  });

  it("IDOR 403", async function () {
    const { trade } = await createAcceptedTrade();
    const other = await registerVerifiedOnboarded({
      email: "tr_other@tradedrop.local",
      handle: "tr_other",
    });

    const propose = await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({});
    assert.strictEqual(propose.status, 403);

    const guest = await request(app)
      .post(`/api/v1/trades/${trade._id}/complete`)
      .send({});
    assert.strictEqual(guest.status, 401);
  });
});
