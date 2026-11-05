const service = require("./service");
const { handleError, one, list } = require("../_shared/controllerKit");
const { sendResponse } = require("@helperUtils/responseUtil");

module.exports = {
  listDrops: list("drops_fetched", (req) => service.listPublic(req, req.user?._id)),
  listAllDrops: list("drops_fetched", (req) => service.getAllDrops(req)),
  listMyDrops: list("drops_fetched", (req) => service.listMyDrops(req.user._id, req)),
  listMyDrafts: one(200, "drops_fetched", (req) => service.listMyDrafts(req.user._id)),
  getDrop: one(200, "drop_fetched", (req) => service.getDrop(req.params.id, req.user?._id)),
  createDrop: async (req, res) => {
    try {
      const data = await service.createDrop(req.user._id, req.body || {});
      const published = data.published === true;
      return sendResponse({
        res,
        statusCode: published ? 200 : 201,
        translationKey: published ? "drop_published" : "drop_created",
        data,
      });
    } catch (error) {
      return handleError(res, error);
    }
  },
  publishDrop: one(200, "drop_published", (req) => service.publishDrop(req.user._id, req.params.id)),
  closeDrop: one(200, "drop_closed", (req) => service.closeDrop(req.user._id, req.params.id)),
  reopenDrop: one(200, "drop_reopened", (req) => service.reopenDrop(req.user._id, req.params.id)),
  extendDrop: one(200, "drop_extended", (req) => service.extendDrop(req.user._id, req.params.id)),
  patchDrop: one(200, "drop_updated", (req) => service.patchDrop(req.user._id, req.params.id, req.body || {})),
  deleteDrop: one(200, "drop_deleted", (req) => service.deleteDrop(req.user._id, req.params.id)),
};
