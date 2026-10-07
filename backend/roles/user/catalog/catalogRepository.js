const { useMongoRepository } = require("../_shared/repoMode");
const memory = require("./memoryCatalogStore");
const mongo = require("./mongoCatalogRepository");

function memoryAdapter() {
  return {
    reset: () => memory.resetCatalogStore(),
    listCategories: () => memory.listActiveCategories(),
    listAllCategories: () => memory.listAllCategories(),
    getCategories: (args) => memory.getCategories(args),
    findCmsBySlug: (slug) => memory.findCmsBySlug(slug),
    findCategoryById: (id) => memory.findCategoryById(id),
    findCategoryBySlug: (slug) => memory.findCategoryBySlug(slug),
    createCategory: (data) => memory.createCategory(data),
    updateCategory: (id, patch) => memory.updateCategory(id, patch),
    toPublic: memory.toPublic,
    allowedCmsSlugs: memory.ALLOWED_CMS_SLUGS,
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
