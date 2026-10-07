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

describe("TradeDrop Slice 5 — Tap-ins mock (memory)", function () {
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

    return { token, email, handle, craftId };
  }

  async function createDrop(token, craftId, extra = {}) {
    const res = await request(app)
      .post("/api/v1/drops")
      .set("Authorization", `Bearer ${token}`)
      .send({
        needText: "Need a collaborator",
        offerText: "Offer my skill",
        needCategoryId: craftId,
        offerCategoryId: craftId,
        timingChip: "asap",
        areaLabel: "Brooklyn",
        ...extra,
      });
    assert.strictEqual(res.status, 201, res.body.message);
    return res.body.data;
  }

  it("create tap-in happy path", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "owner_ti@tradedrop.local",
      handle: "owner_ti",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "app_ti@tradedrop.local",
      handle: "app_ti",
    });
    const drop = await createDrop(owner.token, owner.craftId);

    const res = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({
        yourOffer: "I can shoot Saturday",
        availability: "Sat–Sun",
        note: "Flexible",
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.status, "pending");
    assert.strictEqual(res.body.data.dropId, drop._id);
  });

  it("401 guest cannot tap in", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "og@tradedrop.local",
      handle: "og_user",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    const res = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .send({ yourOffer: "x", availability: "y" });
    assert.strictEqual(res.status, 401);
  });

  it("403 cannot tap in on own drop", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "own@tradedrop.local",
      handle: "own_drop",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    const res = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ yourOffer: "self", availability: "now" });
    assert.strictEqual(res.status, 403);
  });

  it("403 not onboarded cannot tap in", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "own2@tradedrop.local",
      handle: "own2_d",
    });
    const drop = await createDrop(owner.token, owner.craftId);

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "noob_ti@tradedrop.local",
      password: "password123",
      handle: "noob_ti",
    });
    await request(app).post("/api/v1/auth/otp/verify").send({
      email: "noob_ti@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "noob_ti@tradedrop.local",
      password: "password123",
    });

    const res = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .send({ yourOffer: "x", availability: "y" });
    assert.strictEqual(res.status, 403);
  });

  it("409 duplicate pending; after decline can re-apply", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "dup_o@tradedrop.local",
      handle: "dup_o",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "dup_a@tradedrop.local",
      handle: "dup_a",
    });
    const drop = await createDrop(owner.token, owner.craftId);

    const first = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "one", availability: "week" });
    assert.strictEqual(first.status, 201);

    const dup = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "two", availability: "week" });
    assert.strictEqual(dup.status, 409);

    await request(app)
      .post(`/api/v1/tap-ins/${first.body.data._id}/decline`)
      .set("Authorization", `Bearer ${owner.token}`);

    const again = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "three", availability: "week" });
    assert.strictEqual(again.status, 201);
  });

  it("owner accept creates trade+thread; decline does not", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "acc_o@tradedrop.local",
      handle: "acc_o",
    });
    const a1 = await registerVerifiedOnboarded({
      email: "acc_a1@tradedrop.local",
      handle: "acc_a1",
    });
    const a2 = await registerVerifiedOnboarded({
      email: "acc_a2@tradedrop.local",
      handle: "acc_a2",
    });
    const drop = await createDrop(owner.token, owner.craftId);

    const t1 = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${a1.token}`)
      .send({ yourOffer: "offer1", availability: "asap" });
    const t2 = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${a2.token}`)
      .send({ yourOffer: "offer2", availability: "asap" });

    const declined = await request(app)
      .post(`/api/v1/tap-ins/${t2.body.data._id}/decline`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(declined.status, 200);
    assert.strictEqual(declined.body.data.tapIn.status, "declined");
    assert.strictEqual(tapInRepo.listTrades().length, 0);
    assert.strictEqual(tapInRepo.listThreads().length, 0);

    const accepted = await request(app)
      .post(`/api/v1/tap-ins/${t1.body.data._id}/accept`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.body.data.tapIn.status, "accepted");
    assert.ok(accepted.body.data.trade);
    assert.ok(accepted.body.data.thread);
    assert.strictEqual(accepted.body.data.trade.status, "in_progress");
    assert.strictEqual(tapInRepo.listTrades().length, 1);
    assert.strictEqual(tapInRepo.listThreads().length, 1);
  });

  it("applicant withdraw pending; owner cannot withdraw", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "w_o@tradedrop.local",
      handle: "w_o",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "w_a@tradedrop.local",
      handle: "w_a",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    const t = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "x", availability: "y" });

    const ownerWithdraw = await request(app)
      .post(`/api/v1/tap-ins/${t.body.data._id}/withdraw`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(ownerWithdraw.status, 403);

    const withdrawn = await request(app)
      .post(`/api/v1/tap-ins/${t.body.data._id}/withdraw`)
      .set("Authorization", `Bearer ${applicant.token}`);
    assert.strictEqual(withdrawn.status, 200);
    assert.strictEqual(withdrawn.body.data.tapIn.status, "withdrawn");
  });

  it("IDOR: other user cannot accept", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "idor_o@tradedrop.local",
      handle: "idor_o",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "idor_a@tradedrop.local",
      handle: "idor_a",
    });
    const other = await registerVerifiedOnboarded({
      email: "idor_x@tradedrop.local",
      handle: "idor_x",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    const t = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "x", availability: "y" });

    const res = await request(app)
      .post(`/api/v1/tap-ins/${t.body.data._id}/accept`)
      .set("Authorization", `Bearer ${other.token}`);
    assert.strictEqual(res.status, 403);
  });

  it("incoming vs outgoing list", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "list_o@tradedrop.local",
      handle: "list_o",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "list_a@tradedrop.local",
      handle: "list_a",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    const t = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "x", availability: "y" });

    const outgoing = await request(app)
      .get("/api/v1/me/tap-ins")
      .query({ direction: "outgoing" })
      .set("Authorization", `Bearer ${applicant.token}`);
    assert.strictEqual(outgoing.status, 200);
    assert.ok(outgoing.body.data.some((x) => x._id === t.body.data._id));

    const incoming = await request(app)
      .get("/api/v1/me/tap-ins")
      .query({ direction: "incoming" })
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(incoming.status, 200);
    assert.ok(incoming.body.data.some((x) => x._id === t.body.data._id));

    const ownerOutgoing = await request(app)
      .get("/api/v1/me/tap-ins")
      .query({ direction: "outgoing" })
      .set("Authorization", `Bearer ${owner.token}`);
    assert.ok(!ownerOutgoing.body.data.some((x) => x._id === t.body.data._id));

    assert.ok(incoming.body.meta);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(incoming.body.meta, "nextCursor"),
      true
    );
  });

  it("multiple accepts on same drop allowed", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "multi_o@tradedrop.local",
      handle: "multi_o",
    });
    const a1 = await registerVerifiedOnboarded({
      email: "multi_a1@tradedrop.local",
      handle: "multi_a1",
    });
    const a2 = await registerVerifiedOnboarded({
      email: "multi_a2@tradedrop.local",
      handle: "multi_a2",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    const t1 = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${a1.token}`)
      .send({ yourOffer: "1", availability: "a" });
    const t2 = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${a2.token}`)
      .send({ yourOffer: "2", availability: "b" });

    const r1 = await request(app)
      .post(`/api/v1/tap-ins/${t1.body.data._id}/accept`)
      .set("Authorization", `Bearer ${owner.token}`);
    const r2 = await request(app)
      .post(`/api/v1/tap-ins/${t2.body.data._id}/accept`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(tapInRepo.listTrades().length, 2);
    assert.strictEqual(tapInRepo.listThreads().length, 2);
  });

  it("cannot tap paused drop → 403", async function () {
    const owner = await registerVerifiedOnboarded({
      email: "pause_o@tradedrop.local",
      handle: "pause_o",
    });
    const applicant = await registerVerifiedOnboarded({
      email: "pause_a@tradedrop.local",
      handle: "pause_a",
    });
    const drop = await createDrop(owner.token, owner.craftId);
    await request(app)
      .post(`/api/v1/drops/${drop._id}/pause`)
      .set("Authorization", `Bearer ${owner.token}`);

    const res = await request(app)
      .post(`/api/v1/drops/${drop._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "x", availability: "y" });
    assert.strictEqual(res.status, 403);
  });
});
