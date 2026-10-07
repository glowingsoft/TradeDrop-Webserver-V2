const express = require("express");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");
const {
  listDisputes,
  getDisputeById,
  startReview,
  approveDispute,
  denyDispute,
  resolveDispute,
} = require("./disputesController");

const router = express.Router();
router.use(auth);
router.use(roleMiddleware(["admin"]));

router.get("/", listDisputes);
router.get("/:id", getDisputeById);
router.post("/:id/review", startReview);
router.post("/:id/approve", approveDispute);
router.post("/:id/deny", denyDispute);
router.post("/:id/resolve", resolveDispute);

module.exports = router;
