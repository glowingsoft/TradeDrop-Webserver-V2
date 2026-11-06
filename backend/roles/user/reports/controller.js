const service = require("./service");
const { one, list, actorOf } = require("../_shared/controllerKit");

module.exports = {
  create: one(201, "report_created", (req) => service.createReport(req.user._id, req.body || {})),
  mine: list("reports_fetched", (req) => service.listMyReports(req.user._id, req)),
  adminList: list("reports_fetched", (req) => service.listReports(req, actorOf(req))),
  moderate: one(200, "report_updated", (req) =>
    service.moderateReport(req.params.id, actorOf(req), req.body || {}),
  ),
};
