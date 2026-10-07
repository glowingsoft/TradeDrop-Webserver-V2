const { useMongoRepository } = require("../_shared/repoMode");
const memory = require("./memoryTimingChipStore");
const mongo = require("./mongoTimingChipRepository");

function memoryAdapter() {
  return memory;
}

function impl() {
  return useMongoRepository() ? mongo : memoryAdapter();
}

module.exports = new Proxy(
  {},
  {
    get(_target, property) {
      const implementation = impl();
      const value = implementation[property];
      return typeof value === "function" ? value.bind(implementation) : value;
    },
  },
);
