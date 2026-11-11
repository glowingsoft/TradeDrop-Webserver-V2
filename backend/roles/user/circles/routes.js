const express = require("express");
const c = require("./controller");
const { optionalAuth, gated } = require("../_shared/authGates");

const router = express.Router();

router.get("/circles", optionalAuth, c.list);
router.get("/circles/all", optionalAuth, c.listAll);
router.get("/me/circles", ...gated, c.mine);
router.get("/circles/:id", optionalAuth, c.get);
router.get("/circles/:id/members", ...gated, c.members);
router.post("/circles", ...gated, c.create);
router.patch("/circles/:id", ...gated, c.update);
router.delete("/circles/:id", ...gated, c.delete);
router.post("/circles/:id/suspend", ...gated, c.toggleSuspend);
router.post("/circles/:id/join", ...gated, c.join);
router.post("/circles/:id/requests/withdraw", ...gated, c.withdrawJoinRequest);
router.post("/circles/:id/leave", ...gated, c.leave);
router.post("/circles/:id/members/:userId/approve", ...gated, c.approveMember);
router.post("/circles/:id/members/:userId/decline", ...gated, c.declineMember);
router.post("/circles/:id/invitations", ...gated, c.invite);
router.post("/circles/:id/invitations/respond", ...gated, c.respondInvitation);
router.post("/circles/:id/transfer-organizer", ...gated, c.transfer);
router.get("/circles/:id/polls", ...gated, c.listPolls);
router.post("/circles/:id/polls", ...gated, c.createPoll);
router.post("/circles/:id/polls/:pollId/vote", ...gated, c.votePoll);
router.post("/circles/:id/polls/vote", ...gated, c.votePoll);

module.exports = router;
