const express = require("express");
const c = require("./controller");
const { optionalAuth, gated } = require("../_shared/authGates");

const router = express.Router();

router.get("/circles", optionalAuth, c.list);
router.get("/me/circles", ...gated, c.mine);
router.get("/circles/:id", optionalAuth, c.get);
router.post("/circles", ...gated, c.create);
router.patch("/circles/:id", ...gated, c.update);
router.delete("/circles/:id", ...gated, c.delete);
router.post("/circles/:id/join", ...gated, c.join);
router.post("/circles/:id/leave", ...gated, c.leave);
router.post("/circles/:id/members/:userId/approve", ...gated, c.approveMember);
router.post("/circles/:id/members/:userId/decline", ...gated, c.declineMember);
router.post("/circles/:id/invitations", ...gated, c.invite);
router.post("/circles/:id/invitations/respond", ...gated, c.respondInvitation);
router.post("/circles/:id/transfer-organizer", ...gated, c.transfer);
router.post("/circles/:id/polls", ...gated, c.createPoll);
router.post("/circles/:id/polls/vote", ...gated, c.votePoll);

module.exports = router;
