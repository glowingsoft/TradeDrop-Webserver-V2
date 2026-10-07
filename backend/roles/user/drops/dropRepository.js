const { useMongoRepository } = require("../_shared/repoMode");
const store = require("./memoryDropStore");
const mongo = require("./mongoDropRepository");

function memoryAdapter() {
  return {
    reset: () => store.resetDropStore(),
    whenReady: () => store.whenReady(),
    findById: (id) => store.findById(id),
    create: (data) => store.create(data),
    update: (id, patch) => store.update(id, patch),
    listAll: () => store.listAll(),
    encodeCursor: store.encodeCursor,
    decodeCursor: store.decodeCursor,
    addDays: store.addDays,
    DROP_TTL_DAYS: store.DROP_TTL_DAYS,
    DEFAULT_LIST_LIMIT: store.DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT: store.MAX_LIST_LIMIT,
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
