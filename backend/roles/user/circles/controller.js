const service = require("./service");
const { one, list } = require("../_shared/controllerKit");

module.exports = {
  create: one(201, "circle_created", (req) => service.createCircle(req.user._id, req.body || {})),
  list: list("circles_fetched", (req) => service.listCircles(req)),
  mine: list("my_circles_fetched", (req) => service.listMyCircles(req.user._id, req)),
  get: one(200, "circle_fetched", (req) => service.getCircle(req.params.id, req.user?._id)),
  update: one(200, "circle_updated", (req) => service.updateCircle(req.user._id, req.params.id, req.body || {})),
  join: one(200, "circle_join_requested", (req) => service.joinCircle(req.user._id, req.params.id)),
  approveMember: one(200, "circle_member_approved", (req) =>
    service.decideMembership(req.user._id, req.params.id, req.params.userId, true),
  ),
  declineMember: one(200, "circle_member_declined", (req) =>
    service.decideMembership(req.user._id, req.params.id, req.params.userId, false),
  ),
  invite: one(200, "circle_invitations_sent", (req) =>
    service.inviteUsers(req.user._id, req.params.id, req.body?.userIds),
  ),
  respondInvitation: one(200, "circle_invitation_responded", (req) =>
    service.respondInvitation(req.user._id, req.params.id, req.body?.accept === true),
  ),
  leave: one(200, "circle_left", (req) => service.leaveCircle(req.user._id, req.params.id)),
  transfer: one(200, "circle_organizer_transferred", (req) =>
    service.transferOrganizer(req.user._id, req.params.id, req.body?.userId),
  ),
  delete: one(200, "circle_deleted", (req) => service.deleteCircle(req.user._id, req.params.id)),
  createPoll: one(201, "circle_poll_created", (req) =>
    service.createPoll(req.user._id, req.params.id, req.body || {}),
  ),
  votePoll: one(200, "circle_poll_voted", (req) =>
    service.votePoll(req.user._id, req.params.id, req.body?.optionIndex),
  ),
};
