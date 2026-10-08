const service = require("./service");
const { one, list, actorOf } = require("../_shared/controllerKit");

module.exports = {
  getTrade: one(200, "trade_fetched", (req) => service.getTrade(req.params.id, actorOf(req))),
  listMyTrades: list("trades_fetched", (req) => service.listMyTrades(req.user._id, req)),
  markDone: one(200, "trade_marked_done", (req) => service.markDone(req.params.id, req.user._id, req.body?.proof)),
  cancelTrade: one(200, "trade_cancelled", (req) => service.cancelTrade(req.params.id, req.user._id)),
  createReview: one(201, "review_created", (req) => service.createReview(req.params.id, req.user._id, req.body || {})),
  listAllReviews: list("reviews_fetched", (req) => service.getAllReviews({ req })),
  listTrades: list("trades_fetched", (req) => service.listTrades(req)),
};
