const service = require("./service");
const { one, list, actorOf } = require("../_shared/controllerKit");

module.exports = {
  raiseDispute: one(201, "dispute_created", (req) => service.raiseDispute(req.params.id, req.user._id, req.body || {})),
  getDisputes: list("disputes_fetched", (req) => service.getDisputes(req)),
  getDispute: one(200, "dispute_fetched", (req) => service.getDispute(req.params.id, actorOf(req))),
  respondDispute: one(200, "dispute_responded", (req) =>
    service.respondDispute(req.params.id, req.user._id, req.body || {}),
  ),
  resolveDispute: one(200, "dispute_resolved", (req) =>
    service.resolveDispute(req.params.id, actorOf(req), req.body || {}),
  ),
  mutualResolveDispute: one(200, "dispute_mutual_resolved", (req) =>
    service.confirmMutualResolution(req.params.id, req.user._id),
  ),
  requestReview: one(200, "dispute_review_requested", (req) =>
    service.requestReview(req.params.id, req.user._id),
  ),
  withdrawDispute: one(200, "dispute_withdrawn", (req) =>
    service.withdrawDispute(req.params.id, req.user._id),
  ),
};
