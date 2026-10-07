/**
 * Trade repository — same store as tap-in accept artifacts (memory or mongo).
 */
const tapInRepo = require("../tapIns/tapInRepository");

module.exports = {
  findById: (id) => tapInRepo.findTradeById(id),
  update: (id, patch) => tapInRepo.updateTrade(id, patch),
  list: () => tapInRepo.listTrades(),
  findReviewByTradeAndFrom: (tradeId, fromUserId) =>
    tapInRepo.findReviewByTradeAndFrom(tradeId, fromUserId),
  createReview: (data) => tapInRepo.createReview(data),
  listReviews: () => tapInRepo.listReviews(),
  listReviewsReceivedBy: (userId) => tapInRepo.listReviewsReceivedBy(userId),
};
