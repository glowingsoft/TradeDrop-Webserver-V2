const express = require("express");
const {
  getDashboardStats,
} = require("./dashboardsController");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("@middlewares/roleMiddleware");

const router = express.Router();

router.use(auth);


// Get all dashboards with pagination
router.get("/", roleMiddleware(["admin"]), getDashboardStats);


module.exports = router;
