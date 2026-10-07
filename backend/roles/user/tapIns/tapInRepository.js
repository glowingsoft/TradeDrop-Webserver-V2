const { useMongoRepository } = require("../_shared/repoMode");
const store = require("./memoryTapInStore");
const mongo = require("./mongoTapInRepository");

function memoryAdapter() {
  return {
    reset: () => store.resetTapInStore(),
    findById: (id) => store.findTapInById(id),
    list: () => store.listTapIns(),
    findPending: (applicantId, dropId) => store.findPending(applicantId, dropId),
    create: (data) => store.createTapIn(data),
    update: (id, patch) => store.updateTapIn(id, patch),
    declinePendingForDrop: (dropId) => store.declinePendingForDrop(dropId),
    findReviewByTapInAndFrom: (tapInId, fromUserId) =>
      store.findReviewByTapInAndFrom(tapInId, fromUserId),
    createTapInReview: (data) => store.createTapInReview(data),
  };
}

function impl() {
  return useMongoRepository() ? mongo : memoryAdapter();
}

module.exports = new Proxy(
  {},
  {
    get(_t, prop) {
      const i = impl();
      const v = i[prop];
      return typeof v === "function" ? v.bind(i) : v;
    },
  },
);
