const express = require("express");
const auth = require("../middlewares/authMiddleware");
const createRateLimiter = require("../helperUtils/rateLimiter");
const {
  createMessageRequest,
  listIncoming,
  listOutgoing,
  acceptMessageRequest,
  rejectMessageRequest,
  blockMessageRequest,
} = require("../controllers/messageRequestsController");

const router = express.Router();
const messageRequestsRateLimiter = createRateLimiter("message-requests", 10, 50);

router.use(auth);
router.post("/", messageRequestsRateLimiter, createMessageRequest);
router.get("/incoming", messageRequestsRateLimiter, listIncoming);
router.get("/outgoing", messageRequestsRateLimiter, listOutgoing);
router.post("/:id/accept", messageRequestsRateLimiter, acceptMessageRequest);
router.post("/:id/reject", messageRequestsRateLimiter, rejectMessageRequest);
router.post("/:id/block", messageRequestsRateLimiter, blockMessageRequest);

module.exports = router;
