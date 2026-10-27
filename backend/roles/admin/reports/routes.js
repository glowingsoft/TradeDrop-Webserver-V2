const express = require("express");
const c = require("../../user/reports/controller");

const router = express.Router();

router.get("/", c.adminList);
router.patch("/:id", c.moderate);

module.exports = router;
