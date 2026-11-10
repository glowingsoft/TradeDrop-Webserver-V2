const service = require("./service");
const { one, list } = require("../_shared/controllerKit");

module.exports = {
  create: one(201, "connection_request_sent", (req) => service.createRequest(req.user._id, req.body || {})),
  incoming: list("connection_requests_fetched", (req) => service.listRequests(req.user._id, "incoming", req)),
  outgoing: list("connection_requests_fetched", (req) => service.listRequests(req.user._id, "outgoing", req)),
  myConnections: list("connections_fetched", (req) => service.listMyConnections(req.user._id, req)),
  accept: one(200, "connection_request_accepted", (req) => service.respond(req.user._id, req.params.id, "accept")),
  decline: one(200, "connection_request_declined", (req) => service.respond(req.user._id, req.params.id, "decline")),
  withdraw: one(200, "connection_request_withdrawn", (req) => service.respond(req.user._id, req.params.id, "withdraw")),
  network: one(200, "network_fetched", (req) => service.getNetwork(req.user._id, req)),
};
