const express = require("express");
const {
  authenticate,
  requireVerifiedOnboarded,
} = require("../auth/tfAuthMiddleware");
const { listMyDrops } = require("./dropController");

const router = express.Router();

router.use(authenticate, requireVerifiedOnboarded);
router.get("/", listMyDrops);

module.exports = router;
