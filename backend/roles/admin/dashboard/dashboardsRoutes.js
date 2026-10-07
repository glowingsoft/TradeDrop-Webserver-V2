const express = require("express");
const {
  getDashboard,
} = require("./dashboardsController");
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");

const router = express.Router();

router.use(auth);

// Create a rate limiter for Dashboard routes
const apiRateLimiter = createRateLimiter("Dashboard");

// Get all dashboards with pagination
router.get("/", roleMiddleware(["admin"]), apiRateLimiter, getDashboard);
router.use("/engagements", require("../../../commonModules/appEngagement/engagementEventsRoutes"));


module.exports = router;
