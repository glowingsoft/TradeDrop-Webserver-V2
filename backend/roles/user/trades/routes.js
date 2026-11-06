const express = require("express");
const c = require("./controller");
const { gated, adminOnly, authenticate } = require("../_shared/authGates");

const router = express.Router();

router.get("/me/trades", ...gated, c.listMyTrades);
router.get("/me/collaborations", ...gated, c.listMyCollaborations);
router.get("/trades", authenticate, c.listTrades);
router.get("/trades/:id", authenticate, c.getTrade);
router.post("/trades/:id/done", ...gated, c.markDone);
router.post("/trades/:id/cancel", ...gated, c.cancelTrade);
router.post("/trades/:id/review", ...gated, c.createReview);
router.get("/reviews", ...adminOnly, c.listAllReviews);

module.exports = router;
