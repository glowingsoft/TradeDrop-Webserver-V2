const assert = require("assert");
const path = require("path");
const request = require("supertest");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.dev"),
});

const {
  createTestApp,
  resetAuthStore,
  authRepo,
} = require("../helpers/createApp");
const { OTP_RESEND_COOLDOWN_MS } = require("../../backend/roles/user/auth/authService");

describe("TradeDrop Slice 1 — Auth mock (memory)", function () {
  this.timeout(10000);

  let app;

  before(function () {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing — expected from .env.dev");
    }
    process.env.DEBUG_OTP = "true";
    process.env.AUTH_REPOSITORY = "memory";
    app = createTestApp();
  });

  beforeEach(function () {
    resetAuthStore();
  });

  async function registerUser(overrides = {}) {
    const body = {
      email: "maya@tradedrop.local",
      password: "password123",
      name: "Maya",
      handle: "maya_lens",
      ...overrides,
    };
    const res = await request(app).post("/api/v1/auth/register").send(body);
    return { res, body };
  }

  it("TC-010 register validation rejects short password", async function () {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "short" });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.message);
  });

  it("TC-005 register + OTP verify signup (happy path)", async function () {
    const { res: reg } = await registerUser();
    assert.strictEqual(reg.status, 201);
    assert.ok(reg.body.data.token);
    assert.strictEqual(
      reg.body.data.accountState.verificationStatus.email,
      "pending"
    );
    assert.ok(reg.body.data.debugOtp);
    assert.match(String(reg.body.data.debugOtp), /^\d{4}$/);

    const verify = await request(app).post("/api/v1/auth/otp/verify").send({
      email: "maya@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    assert.strictEqual(verify.status, 200);
    assert.strictEqual(
      verify.body.data.accountState.verificationStatus.email,
      "verified"
    );
    assert.ok(verify.body.data.token);
  });

  it("TC-011 login success after verify", async function () {
    const { res: reg } = await registerUser({ email: "login@tradedrop.local", handle: "login_user" });
    await request(app).post("/api/v1/auth/otp/verify").send({
      email: "login@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });

    const login = await request(app).post("/api/v1/auth/login").send({
      email: "login@tradedrop.local",
      password: "password123",
    });
    assert.strictEqual(login.status, 200);
    assert.ok(login.body.data.token);
    assert.ok(login.body.message);
  });

  it("login rejects wrong password", async function () {
    await registerUser({ email: "badpw@tradedrop.local", handle: "badpw_user" });
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "badpw@tradedrop.local",
      password: "wrongpassword",
    });
    assert.strictEqual(login.status, 400);
  });

  it("TC-008 OTP lockout after 5 bad verifies", async function () {
    const { res: reg } = await registerUser({
      email: "lock@tradedrop.local",
      handle: "lock_user",
    });
    for (let i = 0; i < 5; i++) {
      const bad = await request(app).post("/api/v1/auth/otp/verify").send({
        email: "lock@tradedrop.local",
        code: "0000",
        purpose: "signup",
      });
      assert.ok([400].includes(bad.status));
    }
    const locked = await request(app).post("/api/v1/auth/otp/verify").send({
      email: "lock@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    assert.strictEqual(locked.status, 400);
    assert.ok(
      String(locked.body.message).toLowerCase().includes("otp") ||
        locked.body.message
    );
  });

  it("TC-009 OTP resend cooldown 30s", async function () {
    const { res: reg } = await registerUser({
      email: "cooldown@tradedrop.local",
      handle: "cool_user",
    });
    assert.strictEqual(reg.status, 201);

    const tooSoon = await request(app).post("/api/v1/auth/otp/resend").send({
      email: "cooldown@tradedrop.local",
      purpose: "signup",
    });
    assert.strictEqual(tooSoon.status, 400);

    const user = authRepo.findByEmail("cooldown@tradedrop.local");
    authRepo.update(user._id, {
      otp: {
        ...user.otp,
        signup: {
          ...user.otp.signup,
          lastSentAt: Date.now() - OTP_RESEND_COOLDOWN_MS - 1000,
        },
      },
    });

    const ok = await request(app).post("/api/v1/auth/otp/resend").send({
      email: "cooldown@tradedrop.local",
      purpose: "signup",
    });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.data.debugOtp);
  });

  it("TC-013/014 password forgot + OTP verify + reset", async function () {
    const { res: reg } = await registerUser({
      email: "reset@tradedrop.local",
      handle: "reset_user",
    });
    await request(app).post("/api/v1/auth/otp/verify").send({
      email: "reset@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });

    const forgot = await request(app)
      .post("/api/v1/auth/password/forgot")
      .send({ email: "reset@tradedrop.local" });
    assert.strictEqual(forgot.status, 200);
    assert.ok(forgot.body.data.debugOtp);

    const verifyReset = await request(app).post("/api/v1/auth/otp/verify").send({
      email: "reset@tradedrop.local",
      code: forgot.body.data.debugOtp,
      purpose: "password_reset",
    });
    assert.strictEqual(verifyReset.status, 200);
    assert.strictEqual(verifyReset.body.data.passwordResetVerified, true);

    const reset = await request(app).post("/api/v1/auth/password/reset").send({
      email: "reset@tradedrop.local",
      password: "newpassword123",
    });
    assert.strictEqual(reset.status, 200);

    const loginOld = await request(app).post("/api/v1/auth/login").send({
      email: "reset@tradedrop.local",
      password: "password123",
    });
    assert.strictEqual(loginOld.status, 400);

    const loginNew = await request(app).post("/api/v1/auth/login").send({
      email: "reset@tradedrop.local",
      password: "newpassword123",
    });
    assert.strictEqual(loginNew.status, 200);
    assert.ok(loginNew.body.data.token);
  });

  it("TC-015 refresh re-issues JWT", async function () {
    const { res: reg } = await registerUser({
      email: "refresh@tradedrop.local",
      handle: "refresh_u",
    });
    const token = reg.body.data.token;
    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(refreshed.status, 200);
    assert.ok(refreshed.body.data.token);
  });

  it("TC-016 logout requires auth and succeeds", async function () {
    const { res: reg } = await registerUser({
      email: "logout@tradedrop.local",
      handle: "logout_u",
    });
    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${reg.body.data.token}`);
    assert.strictEqual(out.status, 200);
  });

  it("guest cannot hit user routes (401)", async function () {
    const me = await request(app).get("/api/v1/me");
    assert.strictEqual(me.status, 401);
    assert.ok(me.body.message);

    const gated = await request(app).post("/api/v1/me/gated-action");
    assert.strictEqual(gated.status, 401);
  });

  it("authenticated GET /me succeeds", async function () {
    const { res: reg } = await registerUser({
      email: "me@tradedrop.local",
      handle: "me_user",
    });
    const me = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${reg.body.data.token}`);
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.data.basicInfo.email, "me@tradedrop.local");
  });

  it("unverified user cannot perform gated action (403)", async function () {
    const { res: reg } = await registerUser({
      email: "unverified@tradedrop.local",
      handle: "unverified_u",
    });
    const gated = await request(app)
      .post("/api/v1/me/gated-action")
      .set("Authorization", `Bearer ${reg.body.data.token}`);
    assert.strictEqual(gated.status, 403);
  });

  it("verified + onboarded user can perform gated action", async function () {
    const { res: reg } = await registerUser({
      email: "verified@tradedrop.local",
      handle: "verified_u",
    });
    await request(app).post("/api/v1/auth/otp/verify").send({
      email: "verified@tradedrop.local",
      code: reg.body.data.debugOtp,
      purpose: "signup",
    });
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "verified@tradedrop.local",
      password: "password123",
    });
    const token = login.body.data.token;

    const cats = await request(app).get("/api/v1/categories");
    const craftId = cats.body.data[0]._id;

    const beforeOnboard = await request(app)
      .post("/api/v1/me/gated-action")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(beforeOnboard.status, 403);

    await request(app)
      .post("/api/v1/me/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({
        crafts: [craftId],
        needText: "Need portfolio shots",
        needCategoryId: craftId,
        offerText: "Hair styling",
        offerCategoryId: craftId,
        areaLabel: "Brooklyn",
        timingChip: "this_week",
      });

    const gated = await request(app)
      .post("/api/v1/me/gated-action")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(gated.status, 200);
    assert.strictEqual(gated.body.data.allowed, true);
  });

  it("refresh without token is 401", async function () {
    const res = await request(app).post("/api/v1/auth/refresh");
    assert.strictEqual(res.status, 401);
  });

  it("duplicate email register is 400", async function () {
    await registerUser({ email: "dup@tradedrop.local", handle: "dup1" });
    const again = await registerUser({
      email: "dup@tradedrop.local",
      handle: "dup2",
    });
    assert.strictEqual(again.res.status, 400);
  });
});
