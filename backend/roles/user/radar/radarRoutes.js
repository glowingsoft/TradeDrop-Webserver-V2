const express = require("express");
const { optionalAuth } = require("../auth/tfAuthMiddleware");
const { getRadar } = require("./radarController");

const router = express.Router();

router.get("/", optionalAuth, getRadar);

module.exports = router;
