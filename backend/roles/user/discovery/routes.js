const express = require("express");
const c = require("./controller");
const { optionalAuth } = require("../_shared/authGates");

const router = express.Router();

router.get("/for-you", optionalAuth, c.forYou);

module.exports = router;
