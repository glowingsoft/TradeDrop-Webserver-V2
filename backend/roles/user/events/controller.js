const service = require("./service");
const { one, list } = require("../_shared/controllerKit");

module.exports = {
  list: list("events_fetched", (req) => service.listEvents(req)),
  get: one(200, "event_fetched", (req) => service.getEvent(req.params.id, req.user?._id)),
  create: one(201, "event_draft_created", (req) => service.createEvent(req.user._id, req.body || {})),
  suggest: one(201, "event_suggested", (req) =>
    service.suggestEvent(req.user._id, req.params.circleId, req.body || {}),
  ),
  update: one(200, "event_updated", (req) => service.updateEvent(req.user._id, req.params.id, req.body || {})),
  publish: one(200, "event_published", (req) => service.publishEvent(req.user._id, req.params.id)),
  cancel: one(200, "event_cancelled", (req) => service.cancelEvent(req.user._id, req.params.id)),
  suggestions: list("event_suggestions_fetched", (req) =>
    service.listSuggestions(req.user._id, req.params.circleId, req),
  ),
  approveSuggestion: one(200, "event_suggestion_approved", (req) =>
    service.reviewSuggestion(req.user._id, req.params.id, true),
  ),
  declineSuggestion: one(200, "event_suggestion_declined", (req) =>
    service.reviewSuggestion(req.user._id, req.params.id, false),
  ),
  deleteSuggestion: one(200, "event_suggestion_deleted", (req) =>
    service.removeSuggestion(req.user._id, req.params.id),
  ),
  rsvp: one(200, "event_rsvp_saved", (req) =>
    service.rsvp(req.user._id, req.params.id, req.body?.showToParticipants === true),
  ),
  cancelRsvp: one(200, "event_rsvp_cancelled", (req) => service.cancelRsvp(req.user._id, req.params.id)),
  approveRsvp: one(200, "event_rsvp_approved", (req) =>
    service.decideRsvp(req.user._id, req.params.id, req.params.userId, true),
  ),
  declineRsvp: one(200, "event_rsvp_declined", (req) =>
    service.decideRsvp(req.user._id, req.params.id, req.params.userId, false),
  ),
};
