const assert = require("assert");
const path = require("path");
const request = require("supertest");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

const { createTestApp, resetAuthStore, resetDropStore } = require("../helpers/createApp");
const catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");
const dropRepo = require("../../backend/roles/user/drops/dropRepository");

describe("TradeDrop Slice 4 — Drops mock (memory)", function () {
  this.timeout(20000);

  let app;

  before(async function () {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — expected from .env.dev");
    }
    process.env.AUTH_REPOSITORY = "memory";
    process.env.DEBUG_OTP = "true";
    app = createTestApp();
    await dropRepo.whenReady();
  });

  beforeEach(async function () {
    resetAuthStore();
    catalogRepo.reset();
    await resetDropStore();
  });

  async function registerVerifiedOnboarded(overrides = {}) {
    const email = overrides.email || `user_${Date.now()}@tradedrop.local`;
    const handle = overrides.handle || `u_${Math.random().toString(36).slice(2, 10)}`;
    const password = "password123";

    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
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

    const login = await request(app).post("/api/v1/auth/login").send({ email, password });
    assert.strictEqual(login.status, 200);
    const token = login.body.data.token;

    const cats = await request(app).get("/api/v1/categories");
    const craftId = cats.body.data[0]._id;

    const onboard = await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Need help",
        needCategoryId: craftId,
        offerText: "Can offer skill",
        offerCategoryId: craftId,
        areaLabel: "Soho",
        timingChip: "this_week",
      });
    assert.strictEqual(onboard.status, 200);

    return { token, email, handle, craftId };
  }

  function dropPayload(craftId, extra = {}) {
    return {
      needText: "Need a model",
      offerText: "Offer photography",
      needCategoryId: craftId,
      offerCategoryId: craftId,
      timingChip: "asap",
      areaLabel: "Brooklyn",
      ...extra,
    };
  }

  it("guest GET /drops list and get by id", async function () {
    const list = await request(app).get("/api/v1/drops");
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.body.data));
    assert.ok(list.body.data.length >= 4);
    assert.ok(list.body.meta);
    assert.strictEqual(list.body.meta.nextCursor, null);
    for (const d of list.body.data) {
      assert.strictEqual(d.status, "active");
      assert.ok(d.needText);
      assert.ok(d.offerText);
      assert.strictEqual(d.yours, undefined);
    }

    const id = list.body.data[0]._id;
    const one = await request(app).get(`/api/v1/drops/${id}`);
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.data._id, id);
  });

  it("drop detail rounds other-user lat/lng to ~3 decimals", async function () {
    const list = await request(app).get("/api/v1/drops");
    const soho = list.body.data.find((d) => d.areaLabel === "Soho");
    assert.ok(soho);
    const one = await request(app).get(`/api/v1/drops/${soho._id}`);
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.data.lat, 40.723);
    assert.strictEqual(one.body.data.lng, -74.002);
    assert.notStrictEqual(one.body.data.lat, 40.7234567);
  });

  it("seed includes maya_lens / Soho Brooklyn style drops", async function () {
    const list = await request(app).get("/api/v1/drops");
    const handles = list.body.data.map((d) => d.ownerHandle);
    assert.ok(handles.includes("maya_lens"));
    const areas = list.body.data.map((d) => d.areaLabel);
    assert.ok(areas.includes("Soho"));
    assert.ok(areas.includes("Brooklyn"));
  });

  it("guest POST drop → 401", async function () {
    const res = await request(app).post("/api/v1/drops").send(dropPayload("x"));
    assert.strictEqual(res.status, 401);
  });

  it("unverified cannot create drop → 403", async function () {
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "uv@tradedrop.local",
      password: "password123",
      handle: "uv_user",
    });
    const res = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${reg.body.data.token}`)
      .send(dropPayload("x"));
    assert.strictEqual(res.status, 403);
  });

  it("verified but not onboarded cannot create drop → 403", async function () {
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "noob@tradedrop.local",
      password: "password123",
      handle: "noob_user",
    });
    await request(app).post("/api/v1/auth/otp/verify").send({
      email: "noob@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "noob@tradedrop.local",
      password: "password123",
    });
    const cats = await request(app).get("/api/v1/categories");
    const res = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .send(dropPayload(cats.body.data[0]._id));
    assert.strictEqual(res.status, 403);
  });

  it("create requires need and offer", async function () {
    const { token, craftId } = await registerVerifiedOnboarded({
      email: "needoffer@tradedrop.local",
      handle: "needoffer_u",
    });
    const missingOffer = await request(app).post("/api/v1/drops").set("Authorization", `Bearer ${token}`).send({
      needText: "Need only",
      needCategoryId: craftId,
      offerCategoryId: craftId,
      timingChip: "asap",
      areaLabel: "Soho",
    });
    assert.strictEqual(missingOffer.status, 400);

    const missingNeed = await request(app).post("/api/v1/drops").set("Authorization", `Bearer ${token}`).send({
      offerText: "Offer only",
      needCategoryId: craftId,
      offerCategoryId: craftId,
      timingChip: "asap",
      areaLabel: "Soho",
    });
    assert.strictEqual(missingNeed.status, 400);
  });

  it("create drop happy path (JWT + verified + onboarded)", async function () {
    const { token, craftId } = await registerVerifiedOnboarded({
      email: "creator@tradedrop.local",
      handle: "creator_u",
    });
    const res = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${token}`)
      .send(dropPayload(craftId));
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.status, "active");
    assert.ok(res.body.data.expiresAt);
    assert.strictEqual(res.body.data.yours, true);
  });

  it("owner pause / resume / fulfill / soft-delete", async function () {
    const { token, craftId } = await registerVerifiedOnboarded({
      email: "owner@tradedrop.local",
      handle: "owner_u",
    });
    const created = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${token}`)
      .send(dropPayload(craftId, { areaLabel: "LES" }));
    const id = created.body.data._id;

    const paused = await request(app).post(`/api/v1/drops/${id}/pause`).set("Authorization", `Bearer ${token}`);
    assert.strictEqual(paused.status, 200);
    assert.strictEqual(paused.body.data.status, "paused");

    const listAfterPause = await request(app).get("/api/v1/drops");
    assert.ok(!listAfterPause.body.data.find((d) => d._id === id));

    const resumed = await request(app).post(`/api/v1/drops/${id}/resume`).set("Authorization", `Bearer ${token}`);
    assert.strictEqual(resumed.status, 200);
    assert.strictEqual(resumed.body.data.status, "active");

    const completed = await request(app).post(`/api/v1/drops/${id}/fulfill`).set("Authorization", `Bearer ${token}`);
    assert.strictEqual(completed.status, 200);
    assert.strictEqual(completed.body.data.status, "completed");

    const patchcompleted = await request(app)
      .patch(`/api/v1/drops/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ detail: "nope" });
    assert.strictEqual(patchcompleted.status, 403);

    // new drop to soft-delete
    const d2 = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${token}`)
      .send(dropPayload(craftId, { needText: "Another need", areaLabel: "Soho" }));
    const id2 = d2.body.data._id;
    const del = await request(app).delete(`/api/v1/drops/${id2}`).set("Authorization", `Bearer ${token}`);
    assert.strictEqual(del.status, 200);

    const gone = await request(app).get(`/api/v1/drops/${id2}`);
    assert.strictEqual(gone.status, 404);
  });

  it("IDOR: other user cannot PATCH", async function () {
    const a = await registerVerifiedOnboarded({
      email: "a_drop@tradedrop.local",
      handle: "a_drop",
    });
    const b = await registerVerifiedOnboarded({
      email: "b_drop@tradedrop.local",
      handle: "b_drop",
    });
    const created = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${a.token}`)
      .send(dropPayload(a.craftId));
    const id = created.body.data._id;

    const patch = await request(app)
      .patch(`/api/v1/drops/${id}`)
      .set("Authorization", `Bearer ${b.token}`)
      .send({ detail: "hack" });
    assert.strictEqual(patch.status, 403);
  });

  it("list excludes paused and deleted", async function () {
    const { token, craftId } = await registerVerifiedOnboarded({
      email: "listx@tradedrop.local",
      handle: "listx_u",
    });
    const created = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${token}`)
      .send(dropPayload(craftId, { needText: "Pause me" }));
    const id = created.body.data._id;

    await request(app).post(`/api/v1/drops/${id}/pause`).set("Authorization", `Bearer ${token}`);

    const list = await request(app).get("/api/v1/drops");
    assert.ok(!list.body.data.some((d) => d._id === id));
  });

  it("cursor pagination returns nextCursor when page full", async function () {
    const { token, craftId } = await registerVerifiedOnboarded({
      email: "page@tradedrop.local",
      handle: "page_u",
    });
    // create enough drops so limit=2 yields a second page (seed already has 4)
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post("/api/v1/drops")
        .set("Authorization", `Bearer ${token}`)
        .send(
          dropPayload(craftId, {
            needText: `Need ${i}`,
            offerText: `Offer ${i}`,
          }),
        );
    }

    const page1 = await request(app).get("/api/v1/drops").query({ limit: 2 });
    assert.strictEqual(page1.status, 200);
    assert.strictEqual(page1.body.data.length, 2);
    assert.ok(page1.body.meta.nextCursor);

    const page2 = await request(app).get("/api/v1/drops").query({ limit: 2, cursor: page1.body.meta.nextCursor });
    assert.strictEqual(page2.status, 200);
    assert.ok(page2.body.data.length >= 1);
    const ids1 = new Set(page1.body.data.map((d) => d._id));
    for (const d of page2.body.data) {
      assert.ok(!ids1.has(d._id));
    }
  });

  it("GET /me/drops owner only (includes paused)", async function () {
    const { token, craftId } = await registerVerifiedOnboarded({
      email: "mine@tradedrop.local",
      handle: "mine_u",
    });
    const created = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${token}`)
      .send(dropPayload(craftId, { needText: "My drop" }));
    const id = created.body.data._id;
    await request(app).post(`/api/v1/drops/${id}/pause`).set("Authorization", `Bearer ${token}`);

    const mine = await request(app).get("/api/v1/me/drops").set("Authorization", `Bearer ${token}`);
    assert.strictEqual(mine.status, 200);
    const found = mine.body.data.find((d) => d._id === id);
    assert.ok(found);
    assert.strictEqual(found.status, "paused");
    assert.strictEqual(found.yours, true);

    const guest = await request(app).get("/api/v1/me/drops");
    assert.strictEqual(guest.status, 401);
  });
});
