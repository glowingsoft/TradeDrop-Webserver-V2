const express = require("express");
const c = require("./controller");
const { gated } = require("../_shared/authGates");

const router = express.Router();

router.post("/reports", ...gated, c.create);
router.get("/me/reports", ...gated, c.mine);

module.exports = router;
