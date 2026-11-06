const express = require("express");

const authController = require("../controllers/authController");

const createRateLimiter = require("../helperUtils/rateLimiter");
const roleMiddleware = require("../middlewares/roleMiddleware");
const auth = require("../middlewares/authMiddleware");
const authenticate = auth;

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

router.post("/register", signupRateLimiter, authController.register);
router.post("/login", loginRateLimiter, authController.login);
router.post("/otp/verify", verifyOtpRateLimiter, (req, res) => {
  req.body.type = req.body.type || "email";
  req.body.otp = req.body.otp || req.body.code;
  return authController.verifyOtp(req, res);
});
router.post("/otp/resend", resendOtpRateLimiter, (req, res) => {
  req.body.type = req.body.type || "email";
  req.body.purpose = req.body.purpose || "signup";
  return authController.generateOtp(req, res);
});
router.post("/password/forgot", generateOtpRateLimiter, (req, res) => {
  req.body.type = "email";
  req.body.purpose = "forgot_password";
  return authController.generateOtp(req, res);
});
router.post("/password/reset", resetPasswordRateLimiter, authController.resetPassword);
router.post("/refresh", authenticate, authController.refresh);
router.post("/logout", authenticate, authController.logout);

router.post("/internal/admin/create", signupRateLimiter, authController.createAdmin);
router.post("/check-email-exists", authController.checkEmailExistsAndVerified);
if (process.env.NODE_ENV || "dev") {
  router.post("/login-test", loginRateLimiterTest, authController.loginTest);
}

router.post("/forgot-password", generateOtpRateLimiter, (req, res, next) => {
  req.body.type = "email";
  req.body.purpose = "forgot_password";
  return authController.generateOtp(req, res, next);
});

router.post("/resend-otp/email", resendOtpRateLimiter, (req, res, next) => {
  req.body.type = "email";
  req.body.purpose = req.body.purpose || "signup";
  return authController.generateOtp(req, res, next);
});

router.post("/resend-otp/phone", resendOtpRateLimiter, (req, res, next) => {
  req.body.type = "phoneNumber";
  authController.generateOtp(req, res, next);
});

router.post("/verify-otp/email", verifyOtpRateLimiter, (req, res, next) => {
  req.body.type = "email";
  req.body.otp = req.body.otp || req.body.code;
  return authController.verifyOtp(req, res, next);
});

router.post("/verify-otp/phone", verifyOtpRateLimiter, (req, res, next) => {
  req.body.type = "phoneNumber";
  authController.verifyOtp(req, res, next);
});

router.post("/reset-password", resetPasswordRateLimiter, (req, res, next) => {
  return authController.resetPassword(req, res, next);
});

router.delete("/delete-account", auth, authController.hardDeleteAccount);

router.post("/social-auth", authController.socialAuth);

// Magic-link routes unused by TradeDrop (OTP-only) — left mounted for legacy
router.get("/link/verify-email", linkRateLimiterEmail, authController.verifyEmailViaLink);
router.post("/link/resend-email", resendEmailVerificationLinkRateLimiter, authController.resendEmailVerificationLink);
router.post("/link/send-password-reset", sendPasswordResetLinkRateLimiter, authController.sendPasswordResetLink);
router.get("/link/reset-password/verify", verifyPasswordResetLinkRateLimiter, authController.verifyPasswordResetLink);
router.post("/link/reset-password", resetPasswordViaLinkRateLimiter, authController.resetPasswordViaLink);

router.post("/change-password", changePasswordRateLimiter, auth, authController.changePassword);

router.put("/company-details", auth, companyDetailsRateLimiter, roleMiddleware(["organizer"]), authController.companyDetails);

module.exports = router;
