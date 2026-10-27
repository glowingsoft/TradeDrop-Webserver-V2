const service = require("./service");
const { one } = require("../_shared/controllerKit");

module.exports = {
  forYou: one(200, "for_you_fetched", (req) => service.forYou(req)),
};
