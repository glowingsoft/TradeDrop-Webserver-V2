const express = require("express");
const { authenticate, optionalAuth, requireVerifiedOnboarded } = require("../auth/tfAuthMiddleware");
const {
  listDrops,
  getDrop,
  createDrop,
  patchDrop,
  pauseDrop,
  resumeDrop,
  completeDrop,
  deleteDrop,
  listAllDrops,
} = require("./dropController");
const { createOnDrop } = require("../tapIns/tapInController");

const router = express.Router();

const gated = [authenticate, requireVerifiedOnboarded];

router.get("/", optionalAuth, listDrops);
router.get("/all", optionalAuth, listAllDrops);
router.post("/:id/tap-ins", ...gated, createOnDrop);
router.get("/:id", optionalAuth, getDrop);
router.post("/", ...gated, createDrop);
router.patch("/:id", ...gated, patchDrop);
router.post("/:id/pause", ...gated, pauseDrop);
router.post("/:id/resume", ...gated, resumeDrop);
router.post("/:id/completed", ...gated, completeDrop);
router.delete("/:id", ...gated, deleteDrop);

module.exports = router;
