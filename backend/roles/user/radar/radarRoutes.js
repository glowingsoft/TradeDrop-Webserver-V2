const express = require("express");
const { optionalAuth } = require("../auth/tfAuthMiddleware");
const { getRadar, getRadarTabs, getRadarPeople, getRadarDrops } = require("./radarController");

const router = express.Router();

router.get("/", optionalAuth, getRadar);
router.get("/people", optionalAuth, getRadarPeople);
router.get("/drops", optionalAuth, getRadarDrops);
router.get("/all", optionalAuth, getRadarTabs);

module.exports = router;
