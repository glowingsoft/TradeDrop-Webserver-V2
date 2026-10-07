/**
 * In-memory CMS page store for admin management
 */

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

/** @type {Map<string, object>} slug -> page */
let pagesBySlug = new Map();

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function seed() {
  pagesBySlug = new Map();
  for (const page of CMS_SEED) {
    pagesBySlug.set(page.slug, {
      slug: page.slug,
      title: page.title,
      bodyMarkdown: page.bodyMarkdown,
    });
  }
}

function findCmsBySlug(slug) {
  const page = pagesBySlug.get(String(slug).toLowerCase().trim());
  return page ? clone(page) : null;
}

function createCmsPage(data) {
  const slug = String(data.slug).toLowerCase().trim();
  const page = {
    slug,
    title: String(data.title).trim(),
    bodyMarkdown: data.bodyMarkdown || "",
  };
  pagesBySlug.set(slug, page);
  return clone(page);
}

function updateCmsPage(slug, patch) {
  const normalizedSlug = String(slug).toLowerCase().trim();
  const existing = pagesBySlug.get(normalizedSlug);
  if (!existing) return null;

  const updated = {
    slug: normalizedSlug,
    title: patch.title || existing.title,
    bodyMarkdown: patch.bodyMarkdown !== undefined ? patch.bodyMarkdown : existing.bodyMarkdown,
  };

  pagesBySlug.set(normalizedSlug, updated);
  return clone(updated);
}

function listAllCmsPages() {
  return Array.from(pagesBySlug.values()).map(clone);
}

function toPublic(page) {
  return clone(page);
}

// Seed on load
seed();

module.exports = {
  findCmsBySlug,
  createCmsPage,
  updateCmsPage,
  listAllCmsPages,
  toPublic,
  CMS_SEED,
};
