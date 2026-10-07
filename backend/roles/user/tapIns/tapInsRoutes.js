const express = require("express");
const { authenticate, requireVerifiedOnboarded } = require("../auth/tfAuthMiddleware");
const {
  accept,
  decline,
  withdraw,
  requestJobCompletion,
  confirmJobCompletion,
  createReview,
  getAll,
} = require("./tapInController");

const router = express.Router();

router.use(authenticate);
router.post("/:id/accept", requireVerifiedOnboarded, accept);
router.post("/:id/decline", requireVerifiedOnboarded, decline);
router.post("/:id/withdraw", requireVerifiedOnboarded, withdraw);
router.post("/:id/jobs/complete", requireVerifiedOnboarded, requestJobCompletion);
router.post("/:id/jobs/complete/confirm", requireVerifiedOnboarded, confirmJobCompletion);
router.post("/:id/review", requireVerifiedOnboarded, createReview);
router.get("/", getAll);

module.exports = router;
