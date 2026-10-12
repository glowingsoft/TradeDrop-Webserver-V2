const express = require("express");
const { optionalAuth } = require("../auth/tfAuthMiddleware");
const { getRadar, getRadarTabs } = require("./radarController");

const router = express.Router();

router.get("/", optionalAuth, getRadar);
router.get("/all", optionalAuth, getRadarTabs);

module.exports = router;
