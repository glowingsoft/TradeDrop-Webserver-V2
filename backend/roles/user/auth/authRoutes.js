const express = require("express");
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const { authenticate } = require("./tfAuthMiddleware");
const {
  register,
  login,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
} = require("./authController");

const router = express.Router();

// Skip Redis-backed limiter in memory/test by using high limits; memory store still works if Redis down (passOnStoreError)
const softLimit = (name) => createRateLimiter(name, 15, 200);

router.post("/register", softLimit("tf-register"), register);
router.post("/login", softLimit("tf-login"), login);
router.post("/otp/verify", softLimit("tf-otp-verify"), verifyOtp);
router.post("/otp/resend", softLimit("tf-otp-resend"), resendOtp);
router.post("/password/forgot", softLimit("tf-pw-forgot"), forgotPassword);
router.post("/password/reset", softLimit("tf-pw-reset"), resetPassword);
router.post("/refresh", softLimit("tf-refresh"), authenticate, refresh);
router.post("/logout", softLimit("tf-logout"), authenticate, logout);

module.exports = router;
