const express = require("express");
const {
  authenticate,
  requireVerifiedOnboarded,
} = require("../auth/tfAuthMiddleware");
const { listMine } = require("./tapInController");

const router = express.Router();

router.use(authenticate, requireVerifiedOnboarded);
router.get("/", listMine);

module.exports = router;
