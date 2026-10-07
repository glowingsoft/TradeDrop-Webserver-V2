const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const TimingChip = require("../../../models/TimingChip");
const { idStr } = require("../_shared/serialize");

const TIMING_CHIP_SEED = [
  { value: "asap", label: "ASAP", sortOrder: 1 },
  { value: "this_week", label: "This Week", sortOrder: 2 },
  { value: "this_month", label: "This Month", sortOrder: 3 },
  { value: "flexible", label: "Flexible", sortOrder: 4 },
];

function toPublic(doc) {
  if (!doc) return null;
  return {
    _id: idStr(doc._id),
    value: doc.value,
    label: doc.label,
    status: doc.status,
    sortOrder: doc.sortOrder ?? 0,
  };
}

async function ensureSeed() {
  if ((await TimingChip.countDocuments()) === 0) {
    await TimingChip.insertMany(TIMING_CHIP_SEED);
  }
}

async function find(filter) {
  await ensureSeed();
  return (await TimingChip.find(filter).lean()).map(toPublic);
}

async function listAll({ req = {}, filter = {} }) {
  await ensureSeed();

  const { page, limit } = parsePaginationParams(req) ?? {
    page: 1,
    limit: 10,
  };

  const { keyword, chipGroup, status } = req?.query ?? {};

  const baseMatch = {
    ...filter,

    ...(keyword?.trim() && {
      name: {
        $regex: keyword.trim(),
        $options: "i",
      },
    }),

    ...(chipGroup?.trim() && {
      chipGroup,
    }),
  };

  const match = {
    ...baseMatch,

    ...(status !== undefined &&
      status !== "" && {
        status,
      }),
  };

  const result = await TimingChip.aggregate([
    {
      $facet: {
        chips: [
          { $match: match },
          {
            $sort: {
              sortOrder: 1,
              name: 1,
            },
          },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],

        total: [{ $match: match }, { $count: "count" }],

        stats: [
          { $match: baseMatch },
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

  const facetResult = result?.[0] || {};

  const total = facetResult?.total?.[0]?.count || 0;

  const meta = generateMeta(page, limit, total);

  meta.stats = {
    active: facetResult?.stats?.find((item) => item._id === "active")?.count || 0,

    inactive: facetResult?.stats?.find((item) => item._id === "inactive")?.count || 0,
  };

  return {
    data: (facetResult?.chips || []).map(toPublic),
    meta,
  };
}
async function findById(id) {
  if (!id) return null;
  await ensureSeed();
  return toPublic(await TimingChip.findById(id).lean());
}

async function findByValue(value) {
  if (!value) return null;
  await ensureSeed();
  return toPublic(await TimingChip.findOne({ value: String(value).toLowerCase().trim() }).lean());
}

async function create(data) {
  const doc = await TimingChip.create(data);
  return toPublic(doc.toObject());
}

async function update(id, patch) {
  const doc = await TimingChip.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  return toPublic(doc);
}

async function remove(id) {
  if (!id) return null;
  return toPublic(await TimingChip.findByIdAndDelete(id).lean());
}

async function reset() {
  await TimingChip.deleteMany({});
}

module.exports = {
  listAll,
  find,
  findById,
  findByValue,
  create,
  update,
  remove,
  reset,
  ensureSeed,
  TIMING_CHIP_SEED,
};
