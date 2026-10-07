const CmsPage = require("../../../models/CmsPage");

async function findBySlug(slug) {
  if (!slug) return null;
  const doc = await CmsPage.findOne({
    slug: String(slug).toLowerCase().trim(),
  }).lean();
  return toPublic(doc);
}

async function create(data) {
  const doc = await CmsPage.create({
    slug: String(data.slug).toLowerCase().trim(),
    title: String(data.title).trim(),
    bodyMarkdown: data.bodyMarkdown || "",
  });
  return toPublic(doc.toObject());
}

async function update(slug, patch) {
  const normalizedSlug = String(slug).toLowerCase().trim();
  const doc = await CmsPage.findOneAndUpdate({ slug: normalizedSlug }, { $set: patch }, { new: true }).lean();
  return toPublic(doc);
}

async function listAll() {
  const docs = await CmsPage.find({}).lean();
  return docs.map(toPublic);
}

function toPublic(doc) {
  if (!doc) return null;
  return {
    slug: doc.slug,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
  };
}

module.exports = {
  findBySlug,
  create,
  update,
  listAll,
  toPublic,
};
