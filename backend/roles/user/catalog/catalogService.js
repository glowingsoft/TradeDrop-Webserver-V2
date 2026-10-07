const repo = require("./catalogRepository");
const CmsPageRepo = require("./cmsPageRepository");
const timingChipRepo = require("./timingChipRepository");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");

function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

async function listCategories() {
  return repo.listCategories();
}

async function getCategories(req, filter = {}) {
  return repo.getCategories({ req, filter });
}

async function getCmsPage(slug) {
  const normalized = String(slug || "")
    .toLowerCase()
    .trim();
  if (!normalized) {
    throw AppError("cms_slug_required", 400);
  }

  const page = await repo.findCmsBySlug(normalized);
  if (!page) {
    throw AppError("cms_not_found", 404);
  }
  return page;
}

// Admin: Create or update category with automatic conversation group
async function createOrUpdateCategory(data = {}) {
  const { slug, name, parentId, chipGroup, image, sortOrder, active } = data;

  if (!slug || !String(slug).trim()) {
    throw AppError("category_slug_required", 400);
  }
  if (!name || !String(name).trim()) {
    throw AppError("category_name_required", 400);
  }
  if (!chipGroup) {
    throw AppError("category_chipgroup_invalid", 400);
  }

  const categoryData = {
    slug: String(slug).toLowerCase().trim(),
    name: String(name).trim(),
    chipGroup,
    active: active !== undefined ? Boolean(active) : true,
    image: image || "noimg.png",
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
    parentId: parentId || null,
  };

  // Create or update category
  let category = await repo.findCategoryBySlug(categoryData.slug);
  if (category) {
    // Update existing
    category = await repo.updateCategory(category._id, categoryData);
  } else {
    // Create new
    category = await repo.createCategory(categoryData);
  }

  // Ensure conversation group exists for this category (with empty participants)
  const conversationName = `${chipGroup.toUpperCase()}: ${name}`;
  let conversation = await Conversation.findOne({
    type: "group",
    groupName: conversationName,
  }).lean();

  if (!conversation) {
    conversation = await Conversation.create({
      type: "group",
      groupName: conversationName,
      participants: [], // Empty participants initially
      admins: [],
      groupMetadata: {
        description: `Category group for ${name}`,
      },
      groupSettings: {
        canMessage: true,
        isPrivate: false,
      },
    });
  }

  return {
    category: repo.toPublic(category),
    conversation: {
      _id: conversation._id,
      groupName: conversation.groupName,
      type: conversation.type,
      participants: conversation.participants,
    },
  };
}

async function listAllCategories() {
  return repo.listAllCategories();
}

async function updateCategory(categoryId, data = {}) {
  const category = await repo.findCategoryById(categoryId);
  if (!category) {
    throw AppError("category_not_found", 404);
  }

  const patch = {};

  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw AppError("category_name_required", 400);
    patch.name = name;
  }

  if (data.slug !== undefined) {
    const slug = String(data.slug).toLowerCase().trim();
    if (!slug) throw AppError("category_slug_required", 400);
    if (slug !== category.slug) {
      const existing = await repo.findCategoryBySlug(slug);
      if (existing && String(existing._id) !== String(categoryId)) {
        throw AppError("category_slug_already_exists", 409);
      }
    }
    patch.slug = slug;
  }

  if (data.chipGroup !== undefined) {
    if (!["all", "photo", "makeup", "hair", "video"].includes(data.chipGroup)) {
      throw AppError("category_chipgroup_invalid", 400);
    }
    patch.chipGroup = data.chipGroup;
  }

  if (data.image !== undefined) patch.image = data.image || "noimg.png";
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder) || 0;
  if (data.parentId !== undefined) patch.parentId = data.parentId || null;
  if (data.status !== undefined) patch.status = data.status;

  if (!Object.keys(patch).length) {
    throw AppError("category_update_required", 400);
  }

  const updated = await repo.updateCategory(categoryId, patch);
  return repo.toPublic(updated);
}

async function updateCategoryStatus(categoryId, status) {
  const category = await repo.findCategoryById(categoryId);
  if (!category) {
    throw AppError("category_not_found", 404);
  }
  const updated = await repo.updateCategory(categoryId, { status: status });
  return repo.toPublic(updated);
}

async function addOrUpdateCmsPage(data = {}) {
  const { slug, title, bodyMarkdown } = data;

  if (!slug || !String(slug).trim()) {
    throw AppError("cms_slug_required", 400);
  }
  if (!title || !String(title).trim()) {
    throw AppError("cms_title_required", 400);
  }

  const normalizedSlug = String(slug).toLowerCase().trim();

  let page = await CmsPageRepo.findBySlug(normalizedSlug);
  if (page) {
    // Update existing
    page = await CmsPageRepo.update(normalizedSlug, {
      title: String(title).trim(),
      bodyMarkdown: bodyMarkdown || "",
    });
  } else {
    // Create new
    page = await CmsPageRepo.create({
      slug: normalizedSlug,
      title: String(title).trim(),
      bodyMarkdown: bodyMarkdown || "",
    });
  }

  return CmsPageRepo.toPublic(page);
}

async function listAllCmsPages() {
  return CmsPageRepo.listAll();
}

async function listTimingChips({ req = {} }) {
  return timingChipRepo.listAll({ req });
}

async function createTimingChip(data = {}) {
  const value = String(data.value || "")
    .toLowerCase()
    .trim();
  const label = String(data.label || "").trim();
  if (!value) throw AppError("timing_chip_value_required", 400);
  if (!label) throw AppError("timing_chip_label_required", 400);
  if (await timingChipRepo.findByValue(value)) throw AppError("timing_chip_already_exists", 409);
  return timingChipRepo.create({
    value,
    label,
    active: data.active !== undefined ? Boolean(data.active) : true,
    sortOrder: data.sortOrder !== undefined ? Number(data.sortOrder) : 0,
  });
}

async function updateTimingChip(id, data = {}) {
  if (!(await timingChipRepo.findById(id))) throw AppError("timing_chip_not_found", 404);
  const patch = {};
  if (data.value !== undefined) {
    const value = String(data.value).toLowerCase().trim();
    const duplicate = await timingChipRepo.findByValue(value);
    if (!value) throw AppError("timing_chip_value_required", 400);
    if (duplicate && String(duplicate._id) !== String(id)) throw AppError("timing_chip_already_exists", 409);
    patch.value = value;
  }
  if (data.label !== undefined) {
    patch.label = String(data.label).trim();
    if (!patch.label) throw AppError("timing_chip_label_required", 400);
  }
  if (data.status !== undefined) patch.status = data.status;
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder);
  if (!Object.keys(patch).length) throw AppError("timing_chip_update_required", 400);
  return timingChipRepo.update(id, patch);
}

async function removeTimingChip(id) {
  if (!(await timingChipRepo.findById(id))) throw AppError("timing_chip_not_found", 404);
  return timingChipRepo.remove(id);
}
async function getAppSettings() {
  return repo.getAppSettings();
}

async function updateAppSettings(data = {}) {
  const patch = {};

  if (data.radarRadiusKm !== undefined) {
    const radarRadiusKm = Number(data.radarRadiusKm);

    if (!Number.isFinite(radarRadiusKm) || radarRadiusKm <= 0) {
      throw AppError("radar_radius_invalid", 400);
    }

    patch.radarRadiusKm = radarRadiusKm;
  }

  if (data.dropTtlDays !== undefined) {
    const dropTtlDays = Number(data.dropTtlDays);

    if (!Number.isInteger(dropTtlDays) || dropTtlDays <= 0) {
      throw AppError("drop_ttl_days_invalid", 400);
    }

    patch.dropTtlDays = dropTtlDays;
  }

  if (!Object.keys(patch).length) {
    throw AppError("app_settings_update_required", 400);
  }

  return repo.updateAppSettings(patch);
}

module.exports = {
  listCategories,
  getCategories,
  getCmsPage,
  createOrUpdateCategory,
  listAllCategories,
  updateCategory,
  addOrUpdateCmsPage,
  listAllCmsPages,
  listTimingChips,
  createTimingChip,
  updateTimingChip,
  removeTimingChip,
  AppError,
  getAppSettings,
  updateAppSettings,
  updateCategoryStatus,
};
