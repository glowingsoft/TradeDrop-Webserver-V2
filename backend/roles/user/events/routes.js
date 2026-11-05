const express = require("express");
const c = require("./controller");
const { optionalAuth, gated } = require("../_shared/authGates");

const router = express.Router();

router.get("/events", optionalAuth, c.list);
router.get("/events/all", optionalAuth, c.listAll);
router.get("/events/me/active", ...gated, c.listMyActive);
router.get("/events/:id", optionalAuth, c.get);
router.delete("/events/:id", ...gated, c.remove);
router.post("/events", ...gated, c.create);
router.patch("/events/:id", ...gated, c.update);
router.post("/events/:id/publish", ...gated, c.publish);
router.post("/events/:id/cancel", ...gated, c.cancel);
router.post("/events/:id/rsvp", ...gated, c.rsvp);
router.post("/events/:id/rsvp/cancel", ...gated, c.cancelRsvp);
router.post("/events/:id/rsvp/:userId/approve", ...gated, c.approveRsvp);
router.post("/events/:id/rsvp/:userId/decline", ...gated, c.declineRsvp);
router.post("/circles/:circleId/event-suggestions", ...gated, c.suggest);
router.get("/circles/:circleId/event-suggestions", ...gated, c.suggestions);
router.post("/events/:id/suggestion/approve", ...gated, c.approveSuggestion);
router.post("/events/:id/suggestion/decline", ...gated, c.declineSuggestion);
router.delete("/events/:id/suggestion", ...gated, c.deleteSuggestion);

module.exports = router;
