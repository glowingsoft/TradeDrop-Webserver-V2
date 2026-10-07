/**
 * In-memory catalog store — categories + CMS pages (Slice 2 mock).
 * No Mongo.
 */

const { randomBytes } = require("crypto");
const { parsePaginationParams, generateMeta } = require("../../../helperUtils/responseUtil");
const timingChipStore = require("./memoryTimingChipStore");

const CATEGORY_SEED = [
  { slug: "hairdresser", name: "Hairdresser", chipGroup: "hair", sortOrder: 1 },
  { slug: "barber", name: "Barber", chipGroup: "hair", sortOrder: 2 },
  { slug: "stylist", name: "Stylist", chipGroup: "hair", sortOrder: 3 },
  { slug: "makeup", name: "Makeup", chipGroup: "makeup", sortOrder: 4 },
  { slug: "photographer", name: "Photographer", chipGroup: "photo", sortOrder: 5 },
  { slug: "videographer", name: "Videographer", chipGroup: "video", sortOrder: 6 },
  { slug: "model", name: "Model", chipGroup: "photo", sortOrder: 7 },
  { slug: "editor", name: "Editor", chipGroup: "photo", sortOrder: 8 },
  { slug: "designer", name: "Designer", chipGroup: "photo", sortOrder: 9 },
];

const CMS_SEED = [
  {
    slug: "terms",
    title: "Terms of Use",
    bodyMarkdown: "# Terms of Use\n\nPlaceholder TradeDrop terms.",
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    bodyMarkdown: "# Privacy Policy\n\nPlaceholder TradeDrop privacy policy.",
  },
  {
    slug: "about",
    title: "About TradeDrop",
    bodyMarkdown: "# About TradeDrop\n\nTrade your talent. Grow your craft.",
  },
  {
    slug: "faq",
    title: "FAQ",
    bodyMarkdown: "# FAQ\n\nPlaceholder TradeDrop FAQ.",
  },
];

/** @type {Map<string, object>} */
let categoriesById = new Map();
/** @type {Map<string, string>} slug -> id */
let categorySlugIndex = new Map();
/** @type {Map<string, object>} slug -> page */
let cmsBySlug = new Map();

function createId() {
  return randomBytes(12).toString("hex");
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function seed() {
  categoriesById = new Map();
  categorySlugIndex = new Map();
  cmsBySlug = new Map();

  for (const row of CATEGORY_SEED) {
    const _id = createId();
    const doc = {
      _id,
      slug: row.slug,
      name: row.name,
      parentId: null,
      chipGroup: row.chipGroup,
      active: true,
      sortOrder: row.sortOrder,
      image: "noimg.png",
    };
    categoriesById.set(_id, doc);
    categorySlugIndex.set(row.slug, _id);
  }

  for (const page of CMS_SEED) {
    cmsBySlug.set(page.slug, {
      slug: page.slug,
      title: page.title,
      bodyMarkdown: page.bodyMarkdown,
    });
  }
}

function resetCatalogStore() {
  seed();
}

function listActiveCategories() {
  return Array.from(categoriesById.values())
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(clone);
}

function findCmsBySlug(slug) {
  const page = cmsBySlug.get(
    String(slug || "")
      .toLowerCase()
      .trim(),
  );
  return page ? clone(page) : null;
}

function findCategoryById(id) {
  const c = categoriesById.get(String(id));
  return c ? clone(c) : null;
}

function findCategoryBySlug(slug) {
  const id = categorySlugIndex.get(String(slug).toLowerCase().trim());
  if (!id) return null;
  return findCategoryById(id);
}

function listAllCategories() {
  return Array.from(categoriesById.values())
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(clone);
}

function toPublic(category) {
  return clone(category);
}

function createCategory(data) {
  const _id = createId();
  const doc = {
    _id,
    slug: String(data.slug).toLowerCase().trim(),
    name: data.name,
    parentId: data.parentId || null,
    chipGroup: data.chipGroup,
    status: data.status !== undefined ? data.status : "active",
    sortOrder: data.sortOrder || 0,
    image: data.image || "noimg.png",
  };
  categoriesById.set(_id, doc);
  categorySlugIndex.set(doc.slug, _id);
  return clone(doc);
}

function updateCategory(id, patch) {
  const existing = categoriesById.get(String(id));
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    _id: existing._id,
  };
  categoriesById.set(String(id), next);
  // Update slug index if slug changed
  if (patch.slug && patch.slug !== existing.slug) {
    categorySlugIndex.delete(existing.slug);
    categorySlugIndex.set(patch.slug, String(id));
  }
  return clone(next);
}

function getCategories({ req, filter = {} } = {}) {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, chipGroup, parentId } = req?.query || {};

  let categories = Array.from(categoriesById.values()).filter((c) => c.status === "active");

  if (filter.chipGroup) categories = categories.filter((c) => c.chipGroup === filter.chipGroup);
  if (filter.parentId !== undefined)
    categories = categories.filter((c) => String(c.parentId) === String(filter.parentId));

  if (keyword?.trim()) {
    const needle = keyword.trim().toLowerCase();
    categories = categories.filter((c) => c.name.toLowerCase().includes(needle));
  }
  if (chipGroup) categories = categories.filter((c) => c.chipGroup === chipGroup);
  if (parentId) categories = categories.filter((c) => String(c.parentId) === String(parentId));

  categories = categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const total = categories.length;
  const paged = categories.slice((page - 1) * limit, (page - 1) * limit + limit).map(clone);

  const meta = generateMeta(page, limit, total);
  meta.timingChips = timingChipStore.listActive();

  return { data: paged, meta };
}

const ALLOWED_CMS_SLUGS = CMS_SEED.map((p) => p.slug);

// Seed on load
seed();

module.exports = {
  resetCatalogStore,
  listActiveCategories,
  listAllCategories,
  getCategories,
  findCmsBySlug,
  findCategoryById,
  findCategoryBySlug,
  createCategory,
  updateCategory,
  toPublic,
  ALLOWED_CMS_SLUGS,
  CATEGORY_SEED,
  CMS_SEED,
};
