
const Faq = require("@FaqModel");
const { buildKeywordQueryFromModels } = require("@helperUtils/dbUtils/queryUtil");
const { generateMeta } = require("@helperUtils/responseUtil");






const getFaqss = async ({ timezone,page, limit, keyword, status, userId, date, range,today,skip }) => {

  const pipeline = [];

  // // Apply filters
  // if (status) {
  //   pipeline.push({ $match: { status } });
  // } else {
  //   pipeline.push({ $match: { status: { $ne: "deleted" } } });
  // }

  if (date) {
    const start = new Date(date);
    const end = new Date(new Date(date).setDate(start.getDate() + 1));
    pipeline.push({
      $match: {
        createdAt: { $gte: start, $lt: end }
      }
    });
  }

if (keyword) {
  const keywordMatch = buildKeywordQueryFromModels(
    [
      { schema: Faq.schema }
    ],
    keyword
  );

  if (Object.keys(keywordMatch).length) {
    pipeline.push({ $match: keywordMatch });
  }
}

  pipeline.push({ $sort: { createdAt: -1 } });

  // Apply pagination + counts using $facet
  pipeline.push({
    $facet: {
      data: [
        { $skip: skip },
        ...(limit === 0 ? [] : [{ $limit: limit }])
      ],
      totalFiltered: [{ $count: "count" }]
    }
  });

  const result = await Faq.aggregate(pipeline);

  let Faqss = result[0]?.data || [];
  const totalFiltered = result[0]?.totalFiltered[0]?.count || 0;

  // Additional counts for meta (active/inactive/total by userId as creator)
  const [total, active, inactive] = await Promise.all([
    Faq.countDocuments({ ...(userId && { userId: userId }), status: { $ne: "deleted" } }),
    Faq.countDocuments({ status: "active", ...(userId && { userId: userId }) }),
    Faq.countDocuments({ status: "inactive", ...(userId && { userId: userId }) })
  ]);

  const meta = generateMeta(page, limit, totalFiltered);
  meta.FaqssCount = { total, active, inactive };

  return {Faqss , meta}
}
module.exports = {
  getFaqss,
};