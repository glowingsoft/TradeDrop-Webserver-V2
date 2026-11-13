const repo = require("./mongoCatalogRepository");
const timingChipRepo = require("./mongoTimingChipRepository");
const { normalizeInterests } = require("../_shared/interests");
const { User } = require("@UsersModel");

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

async function getOtherCategoryInterests(req) {
  const user = await User.findById(req.user._id).select("crafts deletedAt").lean();
  if (!user || user.deletedAt) throw AppError("account_not_found", 401);
  return repo.getCategories({
    req,
    filter: { status: "active", _id: { $nin: user.crafts || [] } },
  });
}

async function createOrUpdateCategory(data = {}) {
  const { slug, name, parentId, interests, image, sortOrder, active } = data;

  if (!slug || !String(slug).trim()) {
    throw AppError("category_slug_required", 400);
  }
  if (!name || !String(name).trim()) {
    throw AppError("category_name_required", 400);
  }
  const categoryData = {
    slug: String(slug).toLowerCase().trim(),
    name: String(name).trim(),
    ...(interests !== undefined ? { interests: normalizeInterests(interests, "category_interests_invalid") } : {}),
    active: active !== undefined ? Boolean(active) : true,
    image: image || "noimg.png",
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
    parentId: parentId || null,
  };

  let category = await repo.findCategoryBySlug(categoryData.slug);
  if (category) {
    category = await repo.updateCategory(category._id, categoryData);
  } else {
    category = await repo.createCategory(categoryData);
  }

  return { category: repo.toPublic(category) };
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

  if (data.interests !== undefined) patch.interests = normalizeInterests(data.interests, "category_interests_invalid");

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
  getOtherCategoryInterests,
  createOrUpdateCategory,
  listAllCategories,
  updateCategory,
  listTimingChips,
  createTimingChip,
  updateTimingChip,
  removeTimingChip,
  AppError,
  getAppSettings,
  updateAppSettings,
  updateCategoryStatus,
};
