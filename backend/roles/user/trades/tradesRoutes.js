const express = require("express");
const {
  authenticate,
  requireVerifiedOnboarded,
} = require("../auth/tfAuthMiddleware");
const {
  proposeComplete,
  confirmComplete,
  rejectComplete,
  createReview,
} = require("./tradeController");

const router = express.Router();

router.use(authenticate, requireVerifiedOnboarded);
router.post("/:id/complete", proposeComplete);
router.post("/:id/complete/confirm", confirmComplete);
router.post("/:id/complete/reject", rejectComplete);
router.post("/:id/review", createReview);

module.exports = router;
