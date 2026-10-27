const express = require("express");
const c = require("./controller");
const { gated } = require("../_shared/authGates");

const router = express.Router();

router.get("/activity/:tab", ...gated, c.get);

module.exports = router;
