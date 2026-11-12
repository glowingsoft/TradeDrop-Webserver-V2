const express = require("express");
const c = require("./controller");
const { gated, adminOnly } = require("../_shared/authGates");

const router = express.Router();

router.get("/me/tap-ins", ...gated, c.listMyTapIns);
router.post("/drops/:id/tap-ins", ...gated, c.createTapIn);
router.get("/drops/:id/tap-ins", ...gated, c.manageDropTapIns);
router.post("/proposals", ...gated, c.sendProposal);
router.post("/collaborations", ...gated, c.sendCollaboration);
router.get("/tap-ins", ...adminOnly, c.listAllTapIns);
router.get("/tap-ins/:id", ...gated, c.getTapIn);
router.post("/tap-ins/:id/accept", ...gated, c.acceptTapIn);
router.post("/tap-ins/:id/decline", ...gated, c.declineTapIn);
router.post("/tap-ins/:id/withdraw", ...gated, c.withdrawTapIn);

module.exports = router;
