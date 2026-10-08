const service = require("./service");
const { one, list } = require("../_shared/controllerKit");

const direction = (req) => (req.query.direction === "sent" || req.query.direction === "outgoing" ? "sent" : "received");

module.exports = {
  createTapIn: one(201, "tap_in_created", (req) => service.tapIn(req.user._id, req.params.id, req.body || {})),
  sendProposal: one(201, "proposal_sent", (req) =>
    service.sendDirect("proposal", req.user._id, req.body?.targetUserId, req.body || {}),
  ),
  sendCollaboration: one(201, "collaboration_sent", (req) =>
    service.sendDirect("collaboration", req.user._id, req.body?.targetUserId, req.body || {}),
  ),
  listMyTapIns: list("tap_ins_fetched", (req) => service.listMyTapIns(req.user._id, direction(req), req)),
  listAllTapIns: list("tap_ins_fetched", (req) => service.getAllTapIns({ req })),
  acceptTapIn: one(200, "tap_in_accepted", (req) => service.acceptTapIn(req.user._id, req.params.id)),
  declineTapIn: one(200, "tap_in_declined", (req) => service.declineTapIn(req.user._id, req.params.id)),
  withdrawTapIn: one(200, "tap_in_withdrawn", (req) => service.withdrawTapIn(req.user._id, req.params.id)),
};
