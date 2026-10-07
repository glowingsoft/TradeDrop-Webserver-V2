const assert = require("assert");
const path = require("path");
const request = require("supertest");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

const { createTestApp, resetAuthStore, authRepo } = require("../helpers/createApp");
const catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");
const { roundCoord } = require("../../backend/roles/user/me/profileService");

describe("TradeDrop Slice 3 — Profile / portfolio mock (memory)", function () {
  this.timeout(15000);

  let app;

  before(function () {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — expected from .env.dev");
    }
    process.env.AUTH_REPOSITORY = "memory";
    process.env.DEBUG_OTP = "true";
    app = createTestApp();
  });

  beforeEach(function () {
    resetAuthStore();
    catalogRepo.reset();
  });

  async function registerVerified(overrides = {}) {
    const email = overrides.email || "maya@tradedrop.local";
    const handle = overrides.handle || "maya_lens";
    const password = overrides.password || "password123";
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email,
        password,
        name: overrides.name || "Maya",
        handle,
      });
    assert.strictEqual(reg.status, 201);
    await request(app).post("/api/v1/auth/otp/verify").send({
      email,
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    const login = await request(app).post("/api/v1/auth/login").send({ email, password });
    assert.strictEqual(login.status, 200);
    return { token: login.body.data.token, email, handle };
  }

  async function firstCategoryId() {
    const cats = await request(app).get("/api/v1/categories");
    return cats.body.data[0]._id;
  }

  async function onboard(token) {
    const craftId = await firstCategoryId();
    const res = await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Model for golden hour",
        needCategoryId: craftId,
        offerText: "Digitals + edited selects",
        offerCategoryId: craftId,
        areaLabel: "Soho",
        timingChip: "this_week",
        availableDates: ["2026-09-01"],
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.onboarding, true);
    return res;
  }

  it("401 guest on /me", async function () {
    const res = await request(app).get("/api/v1/me");
    assert.strictEqual(res.status, 401);
  });

  it("PATCH /me updates profile fields", async function () {
    const { token } = await registerVerified();
    const res = await request(app).patch("/api/v1/me").set("Authorization", `Bearer ${token}`).send({
      name: "Maya Lens",
      bio: "Photographer in Soho",
      areaLabel: "Soho",
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.basicInfo.name, "Maya Lens");
    assert.strictEqual(res.body.data.basicInfo.bio, "Photographer in Soho");
  });

  it("409 duplicate handle on PATCH", async function () {
    await registerVerified({
      email: "jordan@tradedrop.local",
      handle: "cutbyjordan",
      name: "Jordan",
    });
    const { token } = await registerVerified({
      email: "other@tradedrop.local",
      handle: "other_user",
    });
    const res = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ handle: "cutbyjordan" });
    assert.strictEqual(res.status, 409);
  });

  it("POST /me/avatar sets imageUrl", async function () {
    const { token } = await registerVerified({
      email: "avatar@tradedrop.local",
      handle: "avatar_u",
    });
    const res = await request(app)
      .post("/api/v1/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .send({ imageUrl: "https://cdn.example.com/a.jpg" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.basicInfo.avatarUrl, "https://cdn.example.com/a.jpg");
  });

  it("POST /me/onboarding sets onboardingComplete", async function () {
    const { token } = await registerVerified({
      email: "onboard@tradedrop.local",
      handle: "onboard_u",
    });
    const res = await onboard(token);
    assert.ok(res.body.data.onboarding.complete);
    assert.strictEqual(res.body.data.onboarding.areaLabel, "Soho");
  });

  it("portfolio add and delete (owner)", async function () {
    const { token } = await registerVerified({
      email: "port@tradedrop.local",
      handle: "port_u",
    });
    const add = await request(app)
      .post("/api/v1/me/portfolio")
      .set("Authorization", `Bearer ${token}`)
      .send({
        imageUrl: "https://cdn.example.com/p1.jpg",
        title: "Look 1",
        tags: ["hair"],
      });
    assert.strictEqual(add.status, 201);
    const itemId = add.body.data.item._id;
    assert.ok(itemId);

    const del = await request(app).delete(`/api/v1/me/portfolio/${itemId}`).set("Authorization", `Bearer ${token}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.data.portfolioItems.length, 0);
  });

  it("portfolio max 12", async function () {
    const { token } = await registerVerified({
      email: "maxp@tradedrop.local",
      handle: "maxp_u",
    });
    for (let i = 0; i < 12; i++) {
      const add = await request(app)
        .post("/api/v1/me/portfolio")
        .set("Authorization", `Bearer ${token}`)
        .send({ imageUrl: `https://cdn.example.com/${i}.jpg` });
      assert.strictEqual(add.status, 201);
    }
    const overflow = await request(app)
      .post("/api/v1/me/portfolio")
      .set("Authorization", `Bearer ${token}`)
      .send({ imageUrl: "https://cdn.example.com/x.jpg" });
    assert.strictEqual(overflow.status, 400);
  });

  it("IDOR: cannot delete another user’s portfolio item", async function () {
    const a = await registerVerified({
      email: "a@tradedrop.local",
      handle: "user_a",
    });
    const b = await registerVerified({
      email: "b@tradedrop.local",
      handle: "user_b",
    });
    const add = await request(app)
      .post("/api/v1/me/portfolio")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ imageUrl: "https://cdn.example.com/a.jpg" });
    const itemId = add.body.data.item._id;

    const del = await request(app).delete(`/api/v1/me/portfolio/${itemId}`).set("Authorization", `Bearer ${b.token}`);
    assert.strictEqual(del.status, 404);
  });

  it("PATCH /me/privacy updates flags", async function () {
    const { token } = await registerVerified({
      email: "priv@tradedrop.local",
      handle: "priv_u",
    });
    const res = await request(app).patch("/api/v1/me/privacy").set("Authorization", `Bearer ${token}`).send({
      radarVisible: false,
      hideFromSearch: true,
      openToTrade: false,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.privacy.radarVisible, false);
    assert.strictEqual(res.body.data.privacy.hideFromSearch, true);
    assert.strictEqual(res.body.data.privacy.openToTrade, false);
  });

  it("POST /me/verification stores pending request", async function () {
    const { token } = await registerVerified({
      email: "ver@tradedrop.local",
      handle: "ver_u",
    });
    const res = await request(app)
      .post("/api/v1/me/verification")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "Please verify me" });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.request.status, "pending");
    assert.ok(res.body.data.profile.verificationRequests.length >= 1);
  });

  it("GET /users/:handle public profile — no email; coords rounded", async function () {
    const { token, handle } = await registerVerified({
      email: "maya@tradedrop.local",
      handle: "maya_lens",
    });
    await request(app).patch("/api/v1/me").set("Authorization", `Bearer ${token}`).send({
      bio: "Lens for hire",
      lat: 40.723456789,
      lng: -74.002345678,
      areaLabel: "Soho",
    });
    await onboard(token);

    const res = await request(app).get(`/api/v1/users/${handle}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.basicInfo.handle, "maya_lens");
    assert.strictEqual(res.body.data.basicInfo.email, undefined);
    assert.ok(!("email" in (res.body.data.basicInfo || {})));
    assert.strictEqual(res.body.data.location.lat, roundCoord(40.723456789));
    assert.strictEqual(res.body.data.location.lng, roundCoord(-74.002345678));
  });

  it("404 unknown handle", async function () {
    const res = await request(app).get("/api/v1/users/no_such_handle");
    assert.strictEqual(res.status, 404);
  });

  it("DELETE /me soft-delete → public profile 404", async function () {
    const { token, handle } = await registerVerified({
      email: "gone@tradedrop.local",
      handle: "gone_user",
    });
    const del = await request(app).delete("/api/v1/me").set("Authorization", `Bearer ${token}`);
    assert.strictEqual(del.status, 200);

    const pub = await request(app).get(`/api/v1/users/${handle}`);
    assert.strictEqual(pub.status, 404);

    const user = authRepo.findByHandle(handle);
    assert.ok(user.deletedAt);
    assert.strictEqual(user.email, "");
  });
});
