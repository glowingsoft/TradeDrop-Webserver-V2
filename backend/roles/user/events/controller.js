const service = require("./service");
const { one, list } = require("../_shared/controllerKit");
const { isAdminUser } = require("../_shared/serialize");

module.exports = {
  list: list("events_fetched", (req) => service.listEvents(req)),
  listAll: list("all_events_fetched", (req) => service.listAllEvents(req)),
  listMyActive: one(200, "events_fetched", (req) => service.listMyActiveEvents(req.user._id)),
  remove: one(200, "event_deleted", (req) => service.deleteEvent(req.user._id, req.params.id, isAdminUser(req.user))),
  get: one(200, "event_fetched", (req) => service.getEvent(req.params.id, req.user?._id, isAdminUser(req.user))),
  create: one(201, "event_draft_created", (req) => service.createEvent(req.user._id, req.body || {})),
  suggest: one(201, "event_suggested", (req) =>
    service.suggestEvent(req.user._id, req.params.circleId, req.body || {}),
  ),
  update: one(200, "event_updated", (req) => service.updateEvent(req.user._id, req.params.id, req.body || {})),
  publish: one(200, "event_published", (req) => service.publishEvent(req.user._id, req.params.id, isAdminUser(req.user))),
  cancel: one(200, "event_cancelled", (req) => service.cancelEvent(req.user._id, req.params.id, isAdminUser(req.user))),
  rsvp: one(200, "event_rsvp_saved", (req) =>
    service.rsvp(req.user._id, req.params.id, req.body?.showToParticipants === true),
  ),
  cancelRsvp: one(200, "event_rsvp_cancelled", (req) => service.cancelRsvp(req.user._id, req.params.id)),
  listRsvps: list("event_rsvps_fetched", (req) => service.listRsvps(req.user._id, req.params.id, req)),
  approveRsvp: one(200, "event_rsvp_approved", (req) =>
    service.decideRsvp(req.user._id, req.params.id, req.params.userId, true),
  ),
  declineRsvp: one(200, "event_rsvp_declined", (req) =>
    service.decideRsvp(req.user._id, req.params.id, req.params.userId, false),
  ),
};
