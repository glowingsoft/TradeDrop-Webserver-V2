const express = require("express");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");
const router = express.Router();
router.use("/", require("../../../routes/index"));
router.use(auth, roleMiddleware(["admin"]));
router.use("/settings", require("../settings/adminSettingsRoutes"));
router.use("/users", require("../usersManagement/usersRoutes"));

router.use("/faqs", require("../faqs/faqsRoutes"));
router.use("/help-center", require("../helpCenter/helpCenterRoutes"));
router.use("/dashboard", require("../dashboard/dashboardsRoutes"));
router.use("/dashboard-stats", require("../dashboardStats/dashboardsRoutes"));
router.use("/support", require("../support/supportRoutes"));
router.use("/reports", require("../reports/routes"));
router.use("/catalog", require("../catalog/adminCatalogRoutes"));
router.use("/announcements", require("../announcements/announcementsRoutes"));
router.use("/badges", require("../badges/badgesRoutes"));

module.exports = router;
