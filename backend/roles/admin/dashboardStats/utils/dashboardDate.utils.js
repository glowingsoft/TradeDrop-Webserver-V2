const {
  getStartAndEndOfDay,
  getStartAndEndOfWeek,
  getStartAndEndOfMonth,
} = require("@helperUtils/responseUtil");
const moment = require("moment");

const getDateRanges = ({ dateFilter, timezone }) => {
  const now = new Date();

  if (dateFilter === "all") return null;

  if (dateFilter === "today") {
    const { start, end } = getStartAndEndOfDay(now, timezone);
    const prev = getStartAndEndOfDay(moment(now).subtract(1, "day"), timezone);

    return {
      start,
      end,
      prevStart: prev.start,
      prevEnd: prev.end,
    };
  }

  if (dateFilter === "thisWeek") {
    const { start, end } = getStartAndEndOfWeek(now, timezone);
    const prev = getStartAndEndOfWeek(
      moment(now).subtract(1, "week"),
      timezone,
    );

    return {
      start,
      end,
      prevStart: prev.start,
      prevEnd: prev.end,
    };
  }

  if (dateFilter === "thisMonth") {
    const { start, end } = getStartAndEndOfMonth(now, timezone);
    const prev = getStartAndEndOfMonth(
      moment(now).subtract(1, "month"),
      timezone,
    );

    return {
      start,
      end,
      prevStart: prev.start,
      prevEnd: prev.end,
    };
  }
  if (dateFilter === "lastMonth") {
    const { start, end } = getStartAndEndOfMonth(
      moment(now).subtract(1, "month"),
      timezone,
    );
    const prev = getStartAndEndOfMonth(
      moment(now).subtract(2, "month"),
      timezone,
    );

    return {
      start,
      end,
      prevStart: prev.start,
      prevEnd: prev.end,
    };
  }

  return null;
};

const calculateGrowth = (current, previous, text = "this month") => {
  if (previous === 0) {
    if (current > 0) return `+100% ${text}`;
    return `0% ${text}`;
  }
  const growth = +(((current - previous) / previous) * 100).toFixed(2);

  if (isNaN(growth)) return `0% ${text}`;

  return `${growth >= 0 ? "+" : ""}${growth}% ${text}`;
};

module.exports = {
  getDateRanges,
  calculateGrowth,
};
