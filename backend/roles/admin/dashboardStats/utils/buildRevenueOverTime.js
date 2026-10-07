const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Build a month-wise revenue array from aggregated data
 * @param {Array} rows - array like [{ month: 1, totalRevenue: 20 }, ...]
 */
const buildMonthlyRevenue = (rows = []) => {
  const map = {};
  let total = 0;

  rows.forEach((r) => {
    map[r.month] = r.totalRevenue; // map month index to revenue
    total += r.totalRevenue || 0; // sum total
  });

  const monthsArray = months.map((m, i) => ({
    month: m,
    totalRevenue: map[i + 1] || 0,
  }));

  return { monthsArray, total };
};

/**
 * Combine thisYearRevenue and lastYearRevenue, also calculate totals
 * @param {Object} data - { thisYearRevenue, lastYearRevenue }
 */
const buildRevenueOverTime = (data = {}) => {
  const { monthsArray: thisYear, total: totalThisYear } = buildMonthlyRevenue(
    data.thisYearRevenue,
  );

  const { monthsArray: lastYear, total: totalLastYear } = buildMonthlyRevenue(
    data.lastYearRevenue,
  );

  return {
    thisYear,
    lastYear,
    totalThisYear,
    totalLastYear,
  };
};

module.exports = { buildRevenueOverTime };
