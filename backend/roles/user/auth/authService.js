const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const repo = require("./authRepository");
const { createActivity, activityTypes } = require("@helperUtils/activityUtil");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_LOCK_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

function AppError(translationKey, statusCode = 400, extra = {}) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  err.extra = extra;
  return err;
}

function normalizeEmail(email) {
  return String(email || "")
    .toLowerCase()
    .trim();
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function shouldExposeDebugOtp() {
  return (
    process.env.DEBUG_OTP === "true" ||
    process.env.NODE_ENV === "dev" ||
    process.env.NODE_ENV === "test"
  );
}

function signToken(userId) {
  return jwt.sign({ _id: userId }, process.env.JWT_SECRET);
}

function publicUser(user, token = null) {
  const data = {
    basicInfo: {
      _id: user._id,
      name: user.name || "",
      email: user.email,
      handle: user.handle || "",
      profileIcon: user.profileIcon || "",
      language: user.language || "en",
    },
    accountState: {
      userType: user.accountState?.userType || "user",
      status: user.accountState?.status || "active",
      verificationStatus: {
        email: user.verificationStatus?.email || "pending",
        phoneNumber: user.verificationStatus?.phoneNumber || "pending",
      },
    },
    onboardingComplete: !!user.onboarding,
    metadata: {
      timezone: user.timezone || "UTC",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
  if (token) data.token = token;
  return data;
}

function getOtpSlot(user, purpose) {
  return user.otp?.[purpose] || null;
}

function assertNotLocked(slot) {
  if (slot?.lockedUntil && Date.now() < slot.lockedUntil) {
    throw AppError("too_many_otp_requests", 400);
  }
}

async function issueOtp(user, purpose) {
  const slot = getOtpSlot(user, purpose) || {};
  assertNotLocked(slot);

  if (slot.lastSentAt && Date.now() - slot.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    throw AppError("otp_resend_cooldown", 400);
  }

  const code = generateOtpCode();
  const nextSlot = {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    lockedUntil: null,
    lastSentAt: Date.now(),
    purpose,
  };

  const updated = await repo.update(user._id, {
    otp: { ...(user.otp || {}), [purpose]: nextSlot },
  });

  const payload = { email: updated.email, purpose };
  if (shouldExposeDebugOtp()) payload.debugOtp = code;
  return { user: updated, payload };
}

async function register({ email, password, name, handle, timezone }) {
  email = normalizeEmail(email);
  if (!email) throw AppError("email_required", 400);
  if (!password || String(password).length < 8) {
    throw AppError("password_min_length", 400);
  }
  if (handle) {
    const h = String(handle).toLowerCase().trim();
    if (!HANDLE_RE.test(h)) throw AppError("handle_invalid", 400);
    if (await repo.findByHandle(h)) throw AppError("handle_already_exists", 400);
    handle = h;
  }
  if (await repo.findByEmail(email)) throw AppError("email_already_exists", 400);

  const passwordHash = await bcrypt.hash(password, 10);
  let user = await repo.create({
    email,
    passwordHash,
    name: name || "",
    handle: handle || "",
    timezone: timezone || "UTC",
    verificationStatus: { email: "pending", phoneNumber: "pending" },
    accountState: { userType: "user", status: "active" },
    onboardingComplete: false,
  });

  const { user: withOtp, payload } = await issueOtp(user, "signup");
  const token = signToken(withOtp._id);
  return {
    user: publicUser(withOtp, token),
    debugOtp: payload.debugOtp,
  };
}

async function login({ email, password }) {
  email = normalizeEmail(email);
  if (!email || !password) throw AppError("missing_credentials", 400);

  const user = await repo.findByEmail(email);
  if (!user || user.deletedAt) throw AppError("user_not_found", 404);

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw AppError("incorrect_password", 400);

  if (user.accountState?.status === "suspended" || user.accountState?.status === "restricted") {
    throw AppError("your_account_2", 403);
  }

  const token = signToken(user._id);
  return publicUser(user, token);
}

async function verifyOtp({ email, code, purpose }) {
  email = normalizeEmail(email);
  purpose = purpose === "password_reset" ? "password_reset" : "signup";
  if (!email || !code) throw AppError("missing_parameters", 400);
  if (!/^\d{6}$/.test(String(code))) throw AppError("otp_invalid", 400);

  const user = await repo.findByEmail(email);
  if (!user || user.deletedAt) throw AppError("user_not_found", 404);

  let slot = getOtpSlot(user, purpose);
  if (!slot || !slot.code) throw AppError("otp_not_found", 400);
  assertNotLocked(slot);

  if (Date.now() > slot.expiresAt) throw AppError("otp_expired", 400);

  if (String(slot.code) !== String(code)) {
    const attempts = (slot.attempts || 0) + 1;
    const patch = {
      otp: {
        ...(user.otp || {}),
        [purpose]: {
          ...slot,
          attempts,
          lockedUntil: attempts >= OTP_MAX_ATTEMPTS ? Date.now() + OTP_LOCK_MS : null,
        },
      },
    };
    await repo.update(user._id, patch);
    if (attempts >= OTP_MAX_ATTEMPTS) throw AppError("too_many_otp_requests", 400);
    throw AppError("otp_invalid", 400);
  }

  const clearOtp = { ...(user.otp || {}), [purpose]: null };
  let updated;
  if (purpose === "signup") {
    updated = await repo.update(user._id, {
      otp: clearOtp,
      verificationStatus: { email: "verified" },
    });
    await createActivity({
      type: activityTypes.NEW_SIGNUP,
      user: updated,
    });
  } else {
    updated = await repo.update(user._id, {
      otp: {
        ...clearOtp,
        password_reset: {
          purpose: "password_reset",
          verified: true,
          verifiedAt: Date.now(),
          code: null,
          expiresAt: slot.expiresAt,
          attempts: slot.attempts || 0,
          lockedUntil: null,
          lastSentAt: slot.lastSentAt,
        },
      },
    });
  }

  const token = purpose === "signup" ? signToken(updated._id) : null;
  const data = publicUser(updated, token);
  if (purpose === "password_reset") {
    data.passwordResetVerified = true;
  }
  return data;
}

async function resendOtp({ email, purpose }) {
  email = normalizeEmail(email);
  purpose = purpose === "password_reset" ? "password_reset" : "signup";
  if (!email) throw AppError("email_required", 400);

  const user = await repo.findByEmail(email);
  if (!user || user.deletedAt) throw AppError("user_not_found", 404);

  if (purpose === "signup" && user.verificationStatus?.email === "verified") {
    throw AppError("email_already_verified", 400);
  }

  const { payload } = await issueOtp(user, purpose);
  return payload;
}

async function forgotPassword({ email }) {
  email = normalizeEmail(email);
  if (!email) throw AppError("email_required", 400);

  const user = await repo.findByEmail(email);
  // Do not leak existence — still return success shape if missing
  if (!user || user.deletedAt) {
    return { email, purpose: "password_reset" };
  }

  const { payload } = await issueOtp(user, "password_reset");
  return payload;
}

async function resetPassword({ email, password, code }) {
  email = normalizeEmail(email);
  if (!email || !password) throw AppError("missing_parameters", 400);
  if (String(password).length < 8) throw AppError("password_min_length", 400);

  const user = await repo.findByEmail(email);
  if (!user || user.deletedAt) throw AppError("user_not_found", 404);

  const slot = getOtpSlot(user, "password_reset");
  if (!slot) throw AppError("otp_not_found", 400);

  // Allow reset if already verified via /otp/verify, or verify code inline
  if (!slot.verified) {
    if (!code || !/^\d{4}$/.test(String(code))) throw AppError("otp_invalid", 400);
    assertNotLocked(slot);
    if (Date.now() > slot.expiresAt) throw AppError("otp_expired", 400);
    if (String(slot.code) !== String(code)) {
      throw AppError("otp_invalid", 400);
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await repo.update(user._id, {
    passwordHash,
    otp: { ...(user.otp || {}), password_reset: null },
  });

  return { email };
}

async function refresh(userId) {
  const user = await repo.findById(userId);
  if (!user || user.deletedAt) throw AppError("user_not_found", 401);
  const token = signToken(user._id);
  return publicUser(user, token);
}

function logout() {
  return { ok: true };
}

async function getMe(userId) {
  const user = await repo.findById(userId);
  if (!user || user.deletedAt) throw AppError("user_not_found", 401);
  return publicUser(user);
}

function assertEmailVerified(user) {
  if (user.verificationStatus?.email !== "verified") {
    throw AppError("email_unverified", 403);
  }
}

function assertOnboarded(user) {
  if (!user.onboarding) {
    throw AppError("onboarding_incomplete", 403);
  }
}

/** Gated action: verified email + onboarding (flag for future drop/tap-in) */
async function gatedProbe(userIdOrUser) {
  const id = typeof userIdOrUser === "object" && userIdOrUser?._id ? userIdOrUser._id : userIdOrUser;
  const user = await repo.findById(id);
  if (!user || user.deletedAt) throw AppError("user_not_found", 401);
  assertEmailVerified(user);
  assertOnboarded(user);
  return { allowed: true };
}

module.exports = {
  register,
  login,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  getMe,
  gatedProbe,
  assertEmailVerified,
  assertOnboarded,
  publicUser,
  signToken,
  AppError,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
};
