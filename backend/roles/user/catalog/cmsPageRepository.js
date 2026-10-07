const { useMongoRepository } = require("../_shared/repoMode");
const memory = require("./memoryPageStore");
const mongo = require("./mongoCmsPageRepository");

function memoryAdapter() {
  return {
    findBySlug: (slug) => memory.findCmsBySlug(slug),
    create: (data) => memory.createCmsPage(data),
    update: (slug, patch) => memory.updateCmsPage(slug, patch),
    listAll: () => memory.listAllCmsPages(),
    toPublic: memory.toPublic,
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
