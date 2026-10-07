/**
 * Lightweight Express app for TradeDrop Slice 1 mock auth tests.
 * No Mongo, no Redis, no Socket.IO.
 */
const path = require("path");
const express = require("express");
const i18n = require("i18n");
const { sendResponse } = require("../../backend/helperUtils/responseUtil");

const tfAuth = require("../../backend/roles/user/auth/authController");
const { authenticate } = require("../../backend/roles/user/auth/tfAuthMiddleware");
const userRoutes = require("../../backend/roles/user/routes");
const repo = require("../../backend/roles/user/auth/authRepository");
const legacyAuth = require("../../backend/middlewares/authMiddleware");
const roleMiddleware = require("../../backend/middlewares/roleMiddleware");
const { userCache } = require("../../backend/config/nodeCache");

let i18nReady = false;
function initTestI18n() {
  if (i18nReady) return;
  i18n.configure({
    locales: ["en"],
    directory: path.join(__dirname, "../../backend/assets/locales"),
    defaultLocale: "en",
    objectNotation: true,
    updateFiles: false,
    autoReload: false,
    syncFiles: false,
  });
  i18nReady = true;
}

function createTestApp() {
  initTestI18n();
  const app = express();
  app.use(express.json());
  app.use(i18n.init);

  const authRouter = express.Router();
  authRouter.post("/register", tfAuth.register);
  authRouter.post("/login", tfAuth.login);
  authRouter.post("/otp/verify", tfAuth.verifyOtp);
  authRouter.post("/otp/resend", tfAuth.resendOtp);
  authRouter.post("/password/forgot", tfAuth.forgotPassword);
  authRouter.post("/password/reset", tfAuth.resetPassword);
  authRouter.post("/refresh", authenticate, tfAuth.refresh);
  authRouter.post("/logout", authenticate, tfAuth.logout);

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", userRoutes);

  // Connections / Message Requests / Blocked Users / Disputes (legacy-style, real Mongo models)
  app.use("/api/v1/connections", require("../../backend/routes/connectionRoutes"));
  app.use("/api/v1/message-requests", require("../../backend/routes/messageRequestRoutes"));
  app.use("/api/v1/blocked-users", require("../../backend/routes/blockedUserRoutes"));
  app.use("/api/v1/disputes", require("../../backend/routes/disputeRoutes"));
  app.use(
    "/api/v1/admin/disputes",
    legacyAuth,
    roleMiddleware(["admin"]),
    require("../../backend/roles/admin/disputes/disputesRoutes"),
  );

  app.use((req, res) => {
    sendResponse({
      res,
      statusCode: 404,
      translationKey: "route_not_found",
    });
  });

  return app;
}

module.exports = {
  createTestApp,
  resetAuthStore: () => repo.reset(),
  authRepo: repo,
  resetDropStore: () => require("../../backend/roles/user/drops/dropRepository").reset(),
  resetTapInStore: () => require("../../backend/roles/user/tapIns/tapInRepository").reset(),
  // Promotes a user to admin directly in Mongo and busts the auth-middleware user cache.
  promoteToAdmin: async (userId) => {
    const { User } = require("@UsersModel");
    await User.findByIdAndUpdate(userId, { $set: { "accountState.userType": "admin" } });
    userCache.del(String(userId));
  },
};
