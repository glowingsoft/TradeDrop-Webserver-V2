const mongoose = require("mongoose");
const Category = require("../../../models/Category");
const Area = require("../../../models/Area");
const AppSettings = require("../../../models/AppSettings");
const { idStr, idStrOrNull } = require("../_shared/serialize");
const { getFullImageUrl } = require("@helperUtils/imageHelper");
const Conversation = require("@backend/commonModules/chatModule/models/Conversation");
const { parsePaginationParams, generateMeta } = require("../../../helperUtils/responseUtil");

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

const AREA_SEED = [
  { city: "NYC", label: "Soho", active: true },
  { city: "NYC", label: "Brooklyn", active: true },
  { city: "London", label: "Shoreditch", active: true },
  { city: "NYC", label: "LES", active: true },
];

function toCategory(doc) {
  if (!doc) return null;
  return {
    _id: idStr(doc._id),
    slug: doc.slug,
    name: doc.name,
    parentId: idStrOrNull(doc.parentId),
    chipGroup: doc.chipGroup,
    status: doc.status || "active",
    sortOrder: doc.sortOrder ?? 0,
    image: getFullImageUrl(doc.image) || null,
  };
}

// Alias for compatibility
const toPublic = toCategory;

async function ensureSeed() {
  const count = await Category.countDocuments();
  if (count === 0) {
    await Category.insertMany(CATEGORY_SEED);
    const ccount = await Conversation.countDocuments();
    if (ccount === 0) {
      const conversations = CATEGORY_SEED?.map((c) => {
        const cname = `${c.chipGroup.toUpperCase()}: ${c.name}`;
        return {
          type: "group",
          groupName: cname,
          participants: [], // Empty participants initially
          admins: [],
          groupMetadata: {
            description: `Category group for ${c.name}`,
          },
          groupSettings: {
            canMessage: true,
            isPrivate: false,
          },
        };
      });
      if (conversations.length > 0) {
        await Conversation.insertMany(conversations);
      }
    }
  }
  for (const area of AREA_SEED) {
    await Area.updateOne({ label: area.label }, { $setOnInsert: area }, { upsert: true });
  }
  await AppSettings.updateOne(
    { key: "singleton" },
    {
      $setOnInsert: {
        key: "singleton",
        radarRadiusKm: 8,
        dropTtlDays: 14,
      },
    },
    { upsert: true },
  );
}

async function getAppSettings() {
  await ensureSeed();

  const settings = await AppSettings.findOne({ key: "singleton" }).lean();

  if (!settings) {
    return null;
  }

  return {
    radarRadiusKm: settings.radarRadiusKm ?? 8,
    dropTtlDays: settings.dropTtlDays ?? 14,
  };
}

async function updateAppSettings(patch) {
  await ensureSeed();

  const updates = {};
  if (patch.radarRadiusKm !== undefined) {
    updates.radarRadiusKm = patch.radarRadiusKm;
  }
  if (patch.dropTtlDays !== undefined) {
    updates.dropTtlDays = patch.dropTtlDays;
  }

  const settings = await AppSettings.findOneAndUpdate({ key: "singleton" }, { $set: updates }, { new: true }).lean();

  return {
    radarRadiusKm: settings.radarRadiusKm ?? 8,
    dropTtlDays: settings.dropTtlDays ?? 14,
  };
}

async function listCategories() {
  await ensureSeed();
  const docs = await Category.find({ status: "active" }).sort({ sortOrder: 1 }).lean();
  return docs.map(toCategory);
}

async function findCategoryById(id) {
  if (!id) return null;
  const doc = await Category.findById(id).lean();
  return toCategory(doc);
}

async function findCategoryBySlug(slug) {
  if (!slug) return null;
  const doc = await Category.findOne({
    slug: String(slug).toLowerCase().trim(),
  }).lean();
  return toCategory(doc);
}

async function listAllCategories() {
  await ensureSeed();
  const docs = await Category.find({}).sort({ sortOrder: 1 }).lean();
  return docs.map(toCategory);
}

async function createCategory(data) {
  const doc = await Category.create({
    slug: data.slug,
    name: data.name,
    chipGroup: data.chipGroup,
    status: data.status !== undefined ? data.status : "active",
    image: data.image || "noimg.png",
    sortOrder: data.sortOrder || 0,
    parentId: data.parentId || null,
  });
  return toCategory(doc.toObject());
}

async function updateCategory(id, patch) {
  const doc = await Category.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  return toCategory(doc);
}

async function reset() {
  // cleared by test helper
}

async function getCategories({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);

  const { keyword, chipGroup, parentId, status } = req.query || {
    keyword: "",
    chipGroup: "",
    parentId: "",
    status: "",
  };

  const baseMatch = {
    ...filter,
  };

  if (keyword?.trim()) {
    baseMatch.name = {
      $regex: keyword.trim(),
      $options: "i",
    };
  }

  if (chipGroup) {
    baseMatch.chipGroup = chipGroup;
  }

  if (parentId) {
    baseMatch.parentId = new mongoose.Types.ObjectId(parentId);
  }

  const match = { ...baseMatch };
  // A caller-supplied status may narrow the list but never override a status the route enforces
  if (status && !filter.status) {
    match.status = status;
  }

  const [result] = await Category.aggregate([
    {
      $facet: {
        categories: [
          {
            $match: match,
          },

          {
            $sort: {
              sortOrder: 1,
              name: 1,
            },
          },

          {
            $skip: (page - 1) * limit,
          },

          {
            $limit: limit,
          },

          {
            $project: {
              _id: 1,
              slug: 1,
              name: 1,
              parentId: 1,
              chipGroup: 1,
              status: 1,
              image: { $concat: [process.env.S3_BASE_URL || "", "$image"] },
              sortOrder: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],

        total: [
          {
            $match: match,
          },

          {
            $count: "count",
          },
        ],

        activeStats: [
          {
            $match: baseMatch,
          },

          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;

  const meta = generateMeta(page, limit, total);
  meta.stats = {
    active: result?.activeStats?.find((stat) => stat._id === "active")?.count || 0,
    inactive: result?.activeStats?.find((stat) => stat._id === "inactive")?.count || 0,
  };

  return {
    data: result?.categories || [],
    meta,
  };
}

module.exports = {
  reset,
  getAppSettings,
  updateAppSettings,
  getCategories,
  listCategories,
  listAllCategories,
  findCategoryById,
  findCategoryBySlug,
  createCategory,
  updateCategory,
  toPublic,
  ensureSeed,
  CATEGORY_SEED,
};
