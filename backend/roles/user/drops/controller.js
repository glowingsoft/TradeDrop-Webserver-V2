const service = require("./service");
const { one, list } = require("../_shared/controllerKit");

module.exports = {
  listDrops: list("drops_fetched", (req) => service.listPublic(req, req.user?._id)),
  listAllDrops: list("drops_fetched", (req) => service.getAllDrops(req)),
  listMyDrops: list("drops_fetched", (req) => service.listMyDrops(req.user._id, req)),
  getDrop: one(200, "drop_fetched", (req) => service.getDrop(req.params.id, req.user?._id)),
  createDrop: one(201, "drop_created", (req) => service.createDrop(req.user._id, req.body || {})),
  patchDrop: one(200, "drop_updated", (req) => service.patchDrop(req.user._id, req.params.id, req.body || {})),
  deleteDrop: one(200, "drop_deleted", (req) => service.deleteDrop(req.user._id, req.params.id)),
};
