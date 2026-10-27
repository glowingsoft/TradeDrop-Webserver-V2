const service = require("./service");
const { list } = require("../_shared/controllerKit");

module.exports = {
  get: list("activity_fetched", (req) => service.getActivity(req.user._id, req)),
};
