const express = require("express");
const c = require("./controller");
const { gated, adminOnly, authenticate } = require("../_shared/authGates");

const router = express.Router();

router.post("/trades/:id/disputes", ...gated, c.raiseDispute);
router.get("/disputes", authenticate, c.getDisputes);
router.get("/disputes/:id", authenticate, c.getDispute);
router.post("/disputes/:id/respond", ...gated, c.respondDispute);
router.post("/disputes/:id/mutual-resolved", ...gated, c.mutualResolveDispute);
router.post("/disputes/:id/request-review", ...gated, c.requestReview);
router.post("/disputes/:id/withdraw", ...gated, c.withdrawDispute);
router.post("/disputes/:id/resolve", ...adminOnly, c.resolveDispute);

module.exports = router;
