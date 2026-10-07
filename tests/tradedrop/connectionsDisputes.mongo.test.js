/**
 * TradeDrop Mongo integration — Connections, Message Requests, Blocking, Disputes.
 * AUTH_REPOSITORY=mongo + MONGO_URI_TEST (see tests/tradedrop/mongo.integration.mongo.test.js for setup notes).
 */
const assert = require("assert");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

if (!process.env.MONGO_URI_TEST) {
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

describe("TradeDrop Mongo integration — Connections / Message Requests / Blocking / Disputes", function () {
  this.timeout(60000);

  let request;
  let app;
  let catalogRepo;
  let promoteToAdmin;
  let Connection;

  before(async function () {
    requireMongoUriTest();
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — load from .env.dev");
    }
    await connectTestMongo();

    const helpers = require("../helpers/createApp");
    const { createTestApp } = helpers;
    promoteToAdmin = helpers.promoteToAdmin;
    catalogRepo = require("../../backend/roles/user/catalog/catalogRepository");
    Connection = require("../../backend/models/Connection");
    app = createTestApp();
    request = require("supertest");
  });

  beforeEach(async function () {
    await clearTradeDropCollections();
    await catalogRepo.listCategories();
  });

  after(async function () {
    await clearTradeDropCollections();
    await disconnectTestMongo();
  });

  async function registerVerifiedOnboarded(overrides = {}) {
    const email = overrides.email || `cd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@tradedrop.local`;
    const handle = overrides.handle || `cd_${Math.random().toString(36).slice(2, 10)}`;
    const password = "password123";

    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email,
        password,
        name: overrides.name || "CD User",
        handle,
      });
    assert.strictEqual(reg.status, 201, reg.body.message);

    await request(app).post("/api/v1/auth/otp/verify").send({
      email,
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });

    const login = await request(app).post("/api/v1/auth/login").send({ email, password });
    assert.strictEqual(login.status, 200, login.body.message);
    const token = login.body.data.token;

    const cats = await request(app).get("/api/v1/categories");
    const craftId = overrides.craftId || cats.body.data[0]._id;

    const onboard = await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Need collab",
        needCategoryId: craftId,
        offerText: "Offer skill",
        offerCategoryId: craftId,
        areaLabel: "Soho",
        timingChip: "this_week",
      });
    assert.strictEqual(onboard.status, 200, onboard.body.message);

    const me = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);
    return { token, email, handle, craftId, userId: me.body.data._id };
  }

  async function createDropAndAcceptTapIn(owner, applicant) {
    const drop = await request(app).post("/api/v1/drops").set("Authorization", `Bearer ${owner.token}`).send({
      needText: "Need collaborator",
      offerText: "Offer skill",
      needCategoryId: owner.craftId,
      offerCategoryId: owner.craftId,
      timingChip: "asap",
      areaLabel: "Brooklyn",
    });
    assert.strictEqual(drop.status, 201, drop.body.message);

    const tap = await request(app)
      .post(`/api/v1/drops/${drop.body.data._id}/tap-ins`)
      .set("Authorization", `Bearer ${applicant.token}`)
      .send({ yourOffer: "I can help", availability: "Sat" });
    assert.strictEqual(tap.status, 201, tap.body.message);

    const accepted = await request(app)
      .post(`/api/v1/tap-ins/${tap.body.data._id}/accept`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(accepted.status, 200, accepted.body.message);

    return { drop: drop.body.data, tapIn: tap.body.data };
  }

  it("accepting a tap-in creates exactly one active Connection between owner and applicant", async function () {
    const owner = await registerVerifiedOnboarded({ email: "conn_owner@tradedrop.local", handle: "conn_owner" });
    const applicant = await registerVerifiedOnboarded({ email: "conn_app@tradedrop.local", handle: "conn_app" });
    await createDropAndAcceptTapIn(owner, applicant);

    const connections = await Connection.find({
      $or: [{ user1: owner.userId }, { user2: owner.userId }],
    }).lean();
    assert.strictEqual(connections.length, 1);
    assert.strictEqual(connections[0].status, "active");

    const status = await request(app)
      .get(`/api/v1/connections/${applicant.userId}`)
      .set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.data.connected, true);
  });

  it("does not create a duplicate connection for a second tap-in between the same two users", async function () {
    const owner = await registerVerifiedOnboarded({ email: "dupc_owner@tradedrop.local", handle: "dupc_owner" });
    const applicant = await registerVerifiedOnboarded({ email: "dupc_app@tradedrop.local", handle: "dupc_app" });
    await createDropAndAcceptTapIn(owner, applicant);
    await createDropAndAcceptTapIn(owner, applicant);

    const connections = await Connection.find({
      $or: [{ user1: owner.userId }, { user2: owner.userId }],
    }).lean();
    assert.strictEqual(connections.length, 1, "expected exactly one connection document for the pair");
  });

  it("blocked user cannot send a message request to the blocker", async function () {
    const a = await registerVerifiedOnboarded({ email: "blk_a@tradedrop.local", handle: "blk_a" });
    const b = await registerVerifiedOnboarded({ email: "blk_b@tradedrop.local", handle: "blk_b" });

    const block = await request(app)
      .post("/api/v1/blocked-users")
      .set("Authorization", `Bearer ${b.token}`)
      .send({ userId: a.userId, reason: "spam" });
    assert.strictEqual(block.status, 201, block.body.message);

    const dupBlock = await request(app)
      .post("/api/v1/blocked-users")
      .set("Authorization", `Bearer ${b.token}`)
      .send({ userId: a.userId });
    assert.strictEqual(dupBlock.status, 409);

    const req1 = await request(app)
      .post("/api/v1/message-requests")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ receiverId: b.userId, message: "hi" });
    assert.strictEqual(req1.status, 403);
  });

  it("message request lifecycle: create → accept enables chat, without creating a Connection", async function () {
    const a = await registerVerifiedOnboarded({ email: "mr_a@tradedrop.local", handle: "mr_a" });
    const b = await registerVerifiedOnboarded({ email: "mr_b@tradedrop.local", handle: "mr_b" });

    const created = await request(app)
      .post("/api/v1/message-requests")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ receiverId: b.userId, message: "Hey, want to trade?" });
    assert.strictEqual(created.status, 201, created.body.message);

    const dup = await request(app)
      .post("/api/v1/message-requests")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ receiverId: b.userId, message: "again" });
    assert.strictEqual(dup.status, 409);

    const accepted = await request(app)
      .post(`/api/v1/message-requests/${created.body.data._id}/accept`)
      .set("Authorization", `Bearer ${b.token}`);
    assert.strictEqual(accepted.status, 200, accepted.body.message);
    assert.ok(accepted.body.data.conversationId);

    const connections = await Connection.find({
      $or: [{ user1: a.userId }, { user2: a.userId }],
    }).lean();
    assert.strictEqual(connections.length, 0, "accepting a message request must not create a Connection");
  });

  it("receiver can reject a message request", async function () {
    const a = await registerVerifiedOnboarded({ email: "mrr_a@tradedrop.local", handle: "mrr_a" });
    const b = await registerVerifiedOnboarded({ email: "mrr_b@tradedrop.local", handle: "mrr_b" });

    const created = await request(app)
      .post("/api/v1/message-requests")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ receiverId: b.userId, message: "hi" });
    assert.strictEqual(created.status, 201);

    const rejected = await request(app)
      .post(`/api/v1/message-requests/${created.body.data._id}/reject`)
      .set("Authorization", `Bearer ${b.token}`);
    assert.strictEqual(rejected.status, 200);
    assert.strictEqual(rejected.body.data.status, "rejected");
  });

  it("receiver can block via a message request, preventing further requests", async function () {
    const a = await registerVerifiedOnboarded({ email: "mrb_a@tradedrop.local", handle: "mrb_a" });
    const b = await registerVerifiedOnboarded({ email: "mrb_b@tradedrop.local", handle: "mrb_b" });

    const created = await request(app)
      .post("/api/v1/message-requests")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ receiverId: b.userId, message: "hi" });
    assert.strictEqual(created.status, 201);

    const blocked = await request(app)
      .post(`/api/v1/message-requests/${created.body.data._id}/block`)
      .set("Authorization", `Bearer ${b.token}`);
    assert.strictEqual(blocked.status, 200);

    const again = await request(app)
      .post("/api/v1/message-requests")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ receiverId: b.userId, message: "please respond" });
    assert.strictEqual(again.status, 403);
  });

  it("dispute create requires a valid Drop/TapIn reference and rejects self-report", async function () {
    const owner = await registerVerifiedOnboarded({ email: "disp_owner@tradedrop.local", handle: "disp_owner" });
    const applicant = await registerVerifiedOnboarded({ email: "disp_app@tradedrop.local", handle: "disp_app" });
    const outsider = await registerVerifiedOnboarded({ email: "disp_out@tradedrop.local", handle: "disp_out" });
    const { tapIn } = await createDropAndAcceptTapIn(owner, applicant);

    const selfReport = await request(app)
      .post("/api/v1/disputes")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reportedAgainst: owner.userId, tapIn: tapIn._id, reason: "test" });
    assert.strictEqual(selfReport.status, 400);

    const notParticipant = await request(app)
      .post("/api/v1/disputes")
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ reportedAgainst: applicant.userId, tapIn: tapIn._id, reason: "test" });
    assert.strictEqual(notParticipant.status, 400);

    const valid = await request(app)
      .post("/api/v1/disputes")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reportedAgainst: applicant.userId, tapIn: tapIn._id, reason: "no_show", description: "Did not show up" });
    assert.strictEqual(valid.status, 201, valid.body.message);
    assert.strictEqual(valid.body.data.status, "pending");
  });

  it("admin can review, approve, and deny disputes with an audit trail", async function () {
    const owner = await registerVerifiedOnboarded({ email: "adm_owner@tradedrop.local", handle: "adm_owner" });
    const applicant = await registerVerifiedOnboarded({ email: "adm_app@tradedrop.local", handle: "adm_app" });
    const admin = await registerVerifiedOnboarded({ email: "adm_admin@tradedrop.local", handle: "adm_admin" });
    await promoteToAdmin(admin.userId);

    const { tapIn } = await createDropAndAcceptTapIn(owner, applicant);
    const dispute = await request(app)
      .post("/api/v1/disputes")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reportedAgainst: applicant.userId, tapIn: tapIn._id, reason: "no_show" });
    assert.strictEqual(dispute.status, 201);
    const disputeId = dispute.body.data._id;

    const forbidden = await request(app).get("/api/v1/admin/disputes").set("Authorization", `Bearer ${owner.token}`);
    assert.strictEqual(forbidden.status, 403);

    const list = await request(app).get("/api/v1/admin/disputes").set("Authorization", `Bearer ${admin.token}`);
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.data.some((d) => String(d._id) === String(disputeId)));

    const review = await request(app)
      .post(`/api/v1/admin/disputes/${disputeId}/review`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ note: "Looking into it" });
    assert.strictEqual(review.status, 200);
    assert.strictEqual(review.body.data.status, "under_review");

    const approve = await request(app)
      .post(`/api/v1/admin/disputes/${disputeId}/approve`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ note: "Confirmed via evidence" });
    assert.strictEqual(approve.status, 200);
    assert.strictEqual(approve.body.data.status, "approved");
    assert.strictEqual(approve.body.data.adminReview.decision, "approved");

    const resolve = await request(app)
      .post(`/api/v1/admin/disputes/${disputeId}/resolve`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.strictEqual(resolve.status, 200);
    assert.strictEqual(resolve.body.data.status, "resolved");

    const invalidTransition = await request(app)
      .post(`/api/v1/admin/disputes/${disputeId}/approve`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.strictEqual(invalidTransition.status, 409);

    const AuditLog = require("../../backend/models/AuditLog");
    const logs = await AuditLog.find({ entity: "Dispute", entityId: disputeId }).lean();
    assert.ok(logs.length >= 3, "expected audit logs for review, approve, and resolve actions");
    assert.ok(logs.every((l) => l.performedBy && String(l.performedBy) === String(admin.userId)));
  });

  it("admin can deny a dispute", async function () {
    const owner = await registerVerifiedOnboarded({ email: "deny_owner@tradedrop.local", handle: "deny_owner" });
    const applicant = await registerVerifiedOnboarded({ email: "deny_app@tradedrop.local", handle: "deny_app" });
    const admin = await registerVerifiedOnboarded({ email: "deny_admin@tradedrop.local", handle: "deny_admin" });
    await promoteToAdmin(admin.userId);

    const { tapIn } = await createDropAndAcceptTapIn(owner, applicant);
    const dispute = await request(app)
      .post("/api/v1/disputes")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reportedAgainst: applicant.userId, tapIn: tapIn._id, reason: "no_show" });

    const deny = await request(app)
      .post(`/api/v1/admin/disputes/${dispute.body.data._id}/deny`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ note: "Insufficient evidence" });
    assert.strictEqual(deny.status, 200);
    assert.strictEqual(deny.body.data.status, "denied");
    assert.strictEqual(deny.body.data.adminReview.decision, "denied");
  });
});
