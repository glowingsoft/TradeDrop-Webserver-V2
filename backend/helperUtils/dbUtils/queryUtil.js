const mongoose = require("mongoose");

/**
 * Generic query utilities for Mongoose models.
 * Supports named parameters for flexibility.
 */
async function createWithAutoOrder({ model, data, orderField = "order", match = { status: { $ne: "deleted" } } }) {
  const lastDoc = await model
    .findOne(match)
    .sort({ [orderField]: -1 })
    .select(orderField);
  const nextOrder = lastDoc ? lastDoc[orderField] + 1 : 1;
  const newDoc = new model({ ...data, [orderField]: nextOrder });
  return await newDoc.save();
}

/**
 * Recursively builds lookup pipelines, supporting nested subLookups and $in for arrays
 */
function buildLookupPipeline(lookup) {
  if (!lookup.subLookups || !Array.isArray(lookup.subLookups)) return [];

  const stages = [];

  for (const sub of lookup.subLookups) {
    stages.push({
      $lookup: {
        from: sub.from,
        as: sub.as,
        let: { localField: `$${sub.localField}` },
        pipeline: [
          {
            $match: {
              $expr: {
                $cond: [
                  { $isArray: "$$localField" },
                  { $in: ["$_id", "$$localField"] },
                  { $eq: ["$_id", "$$localField"] },
                ],
              },
            },
          },
          ...(sub.project ? [{ $project: sub.project }] : []),
          ...buildLookupPipeline(sub),
        ],
      },
    });

    // 👇 Automatically convert single-reference lookups to an object
    if (sub.single) {
      stages.push({
        $unwind: { path: `$${sub.as}`, preserveNullAndEmptyArrays: true },
      });
    }
  }

  return stages;
}

/**
 * Generic dynamic aggregation-based query util
 * Supports refPath-based dynamic lookups, nested subLookups, and array refs
 */
async function getWithFilters({
  model,
  query = {},
  populate = [],
  options = {},
  refPath,
  localField = "object",
  refLookups = {},
}) {
  const { sort = { createdAt: -1 }, page = 1, limit = 10, select = null } = options;

  const skip = limit === 0 ? 0 : (page - 1) * limit;
  const baseMatch = { $match: query };

  // If no dynamic refPath, fallback to standard Mongoose query
  if (!refPath || Object.keys(refLookups).length === 0) {
    let q = model.find(query).sort(sort).skip(skip).limit(limit);
    if (select) q = q.select(select);
    populate.forEach((p) => (q = q.populate(p)));
    return q.lean().exec();
  }

  // Build pipelines per ref type
  const typePipelines = Object.entries(refLookups).map(([type, lookup]) => {
    const lookupStage = {
      $lookup: {
        from: lookup.from,
        as: "object",
        let: { localField: `$${localField}` },
        pipeline: [
          {
            $match: {
              $expr: {
                $cond: [
                  { $isArray: "$$localField" },
                  { $in: ["$_id", "$$localField"] },
                  { $eq: ["$_id", "$$localField"] },
                ],
              },
            },
          },
          ...(lookup.project ? [{ $project: lookup.project }] : []),
          ...buildLookupPipeline(lookup),
        ],
      },
    };

    return [
      baseMatch,
      { $match: { [refPath]: type } },
      lookupStage,
      {
        $unwind: { path: "$object", preserveNullAndEmptyArrays: true },
      },
    ];
  });

  // Add fallback for types not in refLookups (like “Other”)
  typePipelines.push([baseMatch, { $match: { [refPath]: { $nin: Object.keys(refLookups) } } }]);

  const [first, ...rest] = typePipelines;

  const pipeline = [
    ...first,
    ...rest.map((p) => ({
      $unionWith: {
        coll: model.collection.name,
        pipeline: p,
      },
    })),
    { $sort: sort },
    { $skip: skip },
    ...(limit > 0 ? [{ $limit: limit }] : []),
  ];

  if (select) pipeline.push({ $project: select });

  return model.aggregate(pipeline);
}

/**
 * Count documents based on query
 */
async function countDocuments({ model, query = {} }) {
  return model.countDocuments(query);
}

/**
 * Return global and filtered counts for statuses (active/inactive/etc)
 * @param {object} params
 * @param {MongooseModel} params.model - The model to query
 * @param {object} [params.filterQuery={}] - The filter for filtered count
 * @param {object} [params.statusMap={ status: ["active", "inactive"] }] - Field and values for facet counts
 */
async function getModelCounts({ model, filterQuery = {}, statusMap = { status: ["active", "inactive"] } }) {
  // Build facets dynamically from the statusMap
  const facetStages = {
    total: [{ $match: { status: { $ne: "deleted" } } }, { $count: "count" }],
  };

  // For each field/value pair, create a facet entry
  for (const [field, values] of Object.entries(statusMap)) {
    for (const value of values) {
      facetStages[value] = [{ $match: { [field]: value } }, { $count: "count" }];
    }
  }

  const [filteredCount, globalCounts] = await Promise.all([
    model.countDocuments(filterQuery),

    model.aggregate([
      {
        $match: {
          "recurringMeta.isTemplate": false,
          status: { $ne: "deleted" },
        },
      },
      { $facet: facetStages },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },
          ...Object.values(statusMap)
            .flat()
            .reduce(
              (acc, val) => ({
                ...acc,
                [val]: {
                  $ifNull: [{ $arrayElemAt: [`$${val}.count`, 0] }, 0],
                },
              }),
              {},
            ),
        },
      },
    ]),
  ]);

  const counts = globalCounts[0] || {};
  return {
    totalFiltered: filteredCount || 0,
    total: counts.total || 0,
    ...Object.fromEntries(Object.entries(counts).filter(([k]) => k !== "total")),
  };
}

/**
 * Find by ID with optional population
 */
async function findById({ model, id, populate = [] }) {
  let q = model.findById(id);
  populate.forEach((p) => (q = q.populate(p)));
  return q.lean().exec();
}

/**
 * Find by ID and update with optional population
 */
async function findByIdAndUpdate({ model, id, data, populate = [] }) {
  let q = model.findByIdAndUpdate(id, data, { new: true });
  populate.forEach((p) => (q = q.populate(p)));
  return q.lean().exec();
}

/**
 * Delete (soft or hard)
 */
async function deleteOne(doc, soft = false) {
  if (!doc) return null;
  return soft ? doc.updateOne({ status: "deleted" }) : doc.deleteOne();
}

/**
 * Update many
 */
async function updateMany({ model, filter, data }) {
  return model.updateMany(filter, data);
}

/**
 * Normalize sequential order fields
 */
async function normalizeOrders({ model, orderField = "order" }) {
  const docs = await model.find({ status: { $ne: "deleted" } }).sort(orderField);
  const ops = docs.map((doc, i) => ({
    updateOne: { filter: { _id: doc._id }, update: { $set: { [orderField]: i + 1 } } },
  }));
  if (ops.length) await model.bulkWrite(ops);
  return true;
}

function buildKeywordQueryFromModels(models, keyword) {
  if (!keyword || !keyword.trim()) return {};

  const orConditions = [];

  function getStringPaths(schema, prefix = "") {
    const paths = [];
    schema.eachPath((pathname, schemaType) => {
      if (schemaType.instance === "String") {
        paths.push(prefix + pathname);
      } else if (schemaType.schema) {
        const nestedPaths = getStringPaths(schemaType.schema, prefix + pathname + ".");
        paths.push(...nestedPaths);
      }
    });
    return paths;
  }
  models.forEach(({ schema, prefix }) => {
    const stringFields = getStringPaths(schema, prefix);
    stringFields.forEach((field) => {
      orConditions.push({ [field]: { $regex: keyword, $options: "i" } });
    });
  });

  return orConditions.length > 0 ? { $or: orConditions } : {};
}

function lookupUserCrafts() {
  return {
    $lookup: {
      from: "categories",
      let: { craftIds: "$crafts" },
      pipeline: [
        { $match: { $expr: { $in: ["$_id", "$$craftIds"] } } },
        { $project: { _id: 1, name: 1, image: { $concat: [process.env.S3_BASE_URL || "", "$image"] } } },
      ],
      as: "crafts",
    },
  };
}
function lookupUserRating() {
  return [
    {
      $lookup: {
        from: "reviews",
        let: { userId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$toUserId", "$$userId"] } } },
          { $group: { _id: null, averageRating: { $avg: "$stars" }, reviewCount: { $sum: 1 } } },
          { $project: { _id: 0, averageRating: { $round: ["$averageRating", 1] }, reviewCount: 1 } },
        ],
        as: "rating",
      },
    },
    {
      $set: {
        averageRating: { $ifNull: [{ $arrayElemAt: ["$rating.averageRating", 0] }, 0] },
        reviewCount: { $ifNull: [{ $arrayElemAt: ["$rating.reviewCount", 0] }, 0] },
      },
    },
    { $unset: "rating" },
  ];
}

module.exports = {
  createWithAutoOrder,
  getWithFilters,
  countDocuments,
  getModelCounts,
  findById,
  findByIdAndUpdate,
  deleteOne,
  updateMany,
  normalizeOrders,
  buildKeywordQueryFromModels,
  lookupUserCrafts,
  lookupUserRating,
};
