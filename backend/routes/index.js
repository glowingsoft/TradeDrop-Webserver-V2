const express = require("express");
const router = express.Router();

router.use("/docs", require("./swaggerRoutes"));
router.use("/auth", require("./authRoutes"));
router.use("/upload", require("./uploadRoutes"));
router.use("/upload/aws", require("./uploadAWSRoutes"));
router.use("/settings", require("../roles/admin/settings/adminSettingsRoutes"));
router.use("/communications", require("./communicationRoutes"));
router.use("/notifications", require("./notificationsRoutes"));
router.use("/support", require("./supportRoutes"));
router.use("/contact-us", require("./contactUsRoutes"));
router.use("/connections", require("./connectionRoutes"));
router.use("/message-requests", require("./messageRequestRoutes"));
router.use("/blocked-users", require("./blockedUserRoutes"));
router.use("/languages", require("./languageRoutes"));
router.use("/util", require("./dbRoutes"));
router.use("/engagement", require("../commonModules/appEngagement/engagementEventsRoutes"));

router.use("/dashboard", require("../roles/admin/dashboard/dashboardsRoutes"));
router.use("/announcements", require("../roles/admin/announcements/announcementsRoutes"));

//locations
router.use("/locations", require("../shared/locations/routes"));
//help center
router.use("/help-center", require("../roles/admin/helpCenter/helpCenterRoutes"));
//users (admin management — JWT)
router.use("/users", require("../roles/admin/usersManagement/usersRoutes"));

//notification preferences
router.use("/notification-preferences", require("./notificationPreferencesRoutes"));

router.use("/share", require("../commonModules/share/shareRoutes"));

router.use("/conversations", require("../commonModules/chatModule/routes/messageRoutes"));

// TradeDrop user domains (Slice 1+: me, later drops/tapIns/…)
router.use(require("../roles/user/routes"));

module.exports = router;
