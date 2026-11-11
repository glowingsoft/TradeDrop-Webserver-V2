const service = require("./service");
const { one, list } = require("../_shared/controllerKit");
const { isAdminUser } = require("../_shared/serialize");

module.exports = {
  create: one(201, "circle_created", (req) => service.createCircle(req.user._id, req.body || {})),
  list: list("circles_fetched", (req) => service.listCircles(req)),
  listAll: list("all_circles_fetched", (req) => service.listAllCircles(req)),
  mine: list("my_circles_fetched", (req) => service.listMyCircles(req.user._id, req)),
  get: one(200, "circle_fetched", (req) => service.getCircle(req.params.id, req.user?._id, isAdminUser(req.user))),
  members: list("circle_members_fetched", (req) => service.listMembers(req.user._id, req.params.id, req)),
  update: one(200, "circle_updated", (req) => service.updateCircle(req.user._id, req.params.id, req.body || {})),
  join: one(200, "circle_join_requested", (req) => service.joinCircle(req.user._id, req.params.id)),
  withdrawJoinRequest: one(200, "circle_request_withdrawn", (req) =>
    service.withdrawJoinRequest(req.user._id, req.params.id),
  ),
  approveMember: one(200, "circle_member_approved", (req) =>
    service.decideMembership(req.user._id, req.params.id, req.params.userId, true, isAdminUser(req.user)),
  ),
  declineMember: one(200, "circle_member_declined", (req) =>
    service.decideMembership(req.user._id, req.params.id, req.params.userId, false, isAdminUser(req.user)),
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
  toggleSuspend: one(200, "circle_suspend_toggled", (req) =>
    service.toggleSuspendCircle(req.user._id, req.params.id, isAdminUser(req.user)),
  ),
  delete: one(200, "circle_deleted", (req) => service.deleteCircle(req.user._id, req.params.id)),
  listPolls: list("circle_polls_fetched", (req) => service.listPolls(req.user._id, req.params.id, req)),
  createPoll: one(201, "circle_poll_created", (req) =>
    service.createPoll(req.user._id, req.params.id, req.body || {}),
  ),
  votePoll: one(200, "circle_poll_voted", (req) =>
    service.votePoll(req.user._id, req.params.id, req.params.pollId || req.body?.pollId, req.body?.optionIndex),
  ),
};
