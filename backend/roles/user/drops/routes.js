const express = require("express");
const c = require("./controller");
const { optionalAuth, gated } = require("../_shared/authGates");

const router = express.Router();

router.get("/me/drops", ...gated, c.listMyDrops);
router.get("/drops", optionalAuth, c.listDrops);
router.get("/drops/all", optionalAuth, c.listAllDrops);
router.get("/drops/:id", optionalAuth, c.getDrop);
router.post("/drops", ...gated, c.createDrop);
router.patch("/drops/:id", ...gated, c.patchDrop);
router.delete("/drops/:id", ...gated, c.deleteDrop);

module.exports = router;
