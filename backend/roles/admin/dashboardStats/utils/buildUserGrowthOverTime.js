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
 * Build month-wise user growth array
 * @param {Array} rows - [{ month: 1, totalUsers: 10 }, ...]
 */
const buildMonthlyUsers = (rows = []) => {
  const map = {};

  rows.forEach((r) => {
    map[r.month] = r.totalUsers;
  });

  return months.map((m, i) => ({
    month: m,
    totalUsers: map[i + 1] || 0,
  }));
};

/**
 * Final response formatter
 */
const buildUserGrowthOverTime = (data = {}) => {
  return {
    coachGrowth: buildMonthlyUsers(data.coachGrowth),
    athleteGrowth: buildMonthlyUsers(data.athleteGrowth),
  };
};

module.exports = { buildUserGrowthOverTime };
