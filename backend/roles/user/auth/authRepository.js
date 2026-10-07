/**
 * Auth repository — memory (default) or Mongo when AUTH_REPOSITORY=mongo.
 */
const { useMongoRepository } = require("../_shared/repoMode");
const memory = require("./memoryUserStore");
const mongo = require("./mongoUserRepository");

function memoryAdapter() {
  return {
    reset: () => memory.resetMemoryStore(),
    findById: (id) => memory.findById(id),
    findByEmail: (email) => memory.findByEmail(email),
    findByHandle: (handle) => memory.findByHandle(handle),
    create: (data) => memory.createUser(data),
    update: (id, patch) => memory.updateUser(id, patch),
    listAll: () => memory.listAllUsers(),
  };
}

function impl() {
  return useMongoRepository() ? mongo : memoryAdapter();
}

module.exports = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "isMongo") return useMongoRepository();
      const i = impl();
      const v = i[prop];
      return typeof v === "function" ? v.bind(i) : v;
    },
  }
);
