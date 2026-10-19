const express = require("express");

const {
  loginTest,
  socialAuth,
  companyDetails,
  verifyEmailViaLink,
  resendEmailVerificationLink,
  sendPasswordResetLink,
  verifyPasswordResetLink,
  resetPasswordViaLink,
  checkEmailExistsAndVerified,
  changePassword,
  createAdmin,
  hardDeleteAccount,
  generateOtp,
  verifyOtp,
  resetPassword,
} = require("../controllers/authController");

const createRateLimiter = require("../helperUtils/rateLimiter");
const roleMiddleware = require("../middlewares/roleMiddleware");
const auth = require("../middlewares/authMiddleware");

const tfAuth = require("../roles/user/auth/authController");
const { authenticate } = require("../roles/user/auth/tfAuthMiddleware");

const router = express.Router();

const signupRateLimiter = createRateLimiter("register", 15, 15);
const loginRateLimiter = createRateLimiter("login", 15, 15);
const loginRateLimiterTest = createRateLimiter("loginTest", 15, 15);
const generateOtpRateLimiter = createRateLimiter("forgotPassword", 15, 15);
const resendOtpRateLimiter = createRateLimiter("resendOtp", 15, 15);
const verifyOtpRateLimiter = createRateLimiter("verifyOtp", 15, 15);
const resetPasswordRateLimiter = createRateLimiter("resetPassword", 15, 15);
const companyDetailsRateLimiter = createRateLimiter("companyDetails", 15, 15);
const linkRateLimiterEmail = createRateLimiter("link/verify-email", 15, 15);
const resendEmailVerificationLinkRateLimiter = createRateLimiter("link/resend-email", 15, 15);
const sendPasswordResetLinkRateLimiter = createRateLimiter("link/send-password-reset", 15, 15);
const verifyPasswordResetLinkRateLimiter = createRateLimiter("link/reset-password/verify", 15, 15);
const resetPasswordViaLinkRateLimiter = createRateLimiter("link/reset-password", 15, 15);
const changePasswordRateLimiter = createRateLimiter("changePassword", 15, 10);

/**
 * TradeDrop consumer auth always uses tfAuth controllers.
 */
router.post("/register", signupRateLimiter, tfAuth.register);
router.post("/login", loginRateLimiter, tfAuth.login);
router.post("/otp/verify", verifyOtpRateLimiter, tfAuth.verifyOtp);
router.post("/otp/resend", resendOtpRateLimiter, tfAuth.resendOtp);
router.post("/password/forgot", generateOtpRateLimiter, tfAuth.forgotPassword);
router.post("/password/reset", resetPasswordRateLimiter, tfAuth.resetPassword);
router.post("/refresh", authenticate, tfAuth.refresh);
router.post("/logout", authenticate, tfAuth.logout);

router.post("/internal/admin/create", signupRateLimiter, createAdmin);
router.post("/check-email-exists", checkEmailExistsAndVerified);
if (process.env.NODE_ENV || "dev") {
  router.post("/login-test", loginRateLimiterTest, loginTest);
}

router.post("/forgot-password", generateOtpRateLimiter, (req, res, next) => {
  return tfAuth.forgotPassword(req, res, next);
});

router.post("/resend-otp/email", resendOtpRateLimiter, (req, res, next) => {
  req.body.purpose = req.body.purpose || "signup";
  return tfAuth.resendOtp(req, res, next);
});

router.post("/resend-otp/phone", resendOtpRateLimiter, (req, res, next) => {
  req.body.type = "phoneNumber";
  generateOtp(req, res, next);
});

router.post("/verify-otp/email", verifyOtpRateLimiter, (req, res, next) => {
  req.body.purpose = req.body.purpose || "signup";
  return tfAuth.verifyOtp(req, res, next);
});

router.post("/verify-otp/phone", verifyOtpRateLimiter, (req, res, next) => {
  req.body.type = "phoneNumber";
  verifyOtp(req, res, next);
});

router.post("/reset-password", resetPasswordRateLimiter, (req, res, next) => {
  return tfAuth.resetPassword(req, res, next);
});

router.delete("/delete-account", auth, hardDeleteAccount);

router.post("/social-auth", socialAuth);

// Magic-link routes unused by TradeDrop (OTP-only) — left mounted for legacy
router.get("/link/verify-email", linkRateLimiterEmail, verifyEmailViaLink);
router.post("/link/resend-email", resendEmailVerificationLinkRateLimiter, resendEmailVerificationLink);
router.post("/link/send-password-reset", sendPasswordResetLinkRateLimiter, sendPasswordResetLink);
router.get("/link/reset-password/verify", verifyPasswordResetLinkRateLimiter, verifyPasswordResetLink);
router.post("/link/reset-password", resetPasswordViaLinkRateLimiter, resetPasswordViaLink);

router.post("/change-password", changePasswordRateLimiter, auth, changePassword);

router.put("/company-details", auth, companyDetailsRateLimiter, roleMiddleware(["organizer"]), companyDetails);

module.exports = router;
