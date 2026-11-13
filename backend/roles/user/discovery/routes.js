const express = require("express");
const c = require("./controller");
const { authenticate } = require("../_shared/authGates");

const router = express.Router();

router.get("/for-you", authenticate, c.forYou);

module.exports = router;
