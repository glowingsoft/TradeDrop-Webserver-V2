// dashboardKeyMap.js

const DASHBOARD_KEYS = {
  totalCoaches: {
    title: "Total Coaches",
  },
  totalAthletes: {
    title: "Total Athletes",
  },
  platformRevenue: {
    title: "Platform Revenue",
  },
  totalSessions: {
    title: "Total Sessions",
  },
  averagePlatformRating: {
    title: "Average Platform Rating",
  },
  totalServices: {
    title: "Total Services",
  },
  totalServicesBooked: {
    title: "Total Booked Services",
  },
  openSupportTickets: {
    title: "Open Support Tickets",
  },

};

const withSubFilters = (key) => {
  const subFilters = DASHBOARD_KEYS[key]?.subFilters;

  const hasSubFilters = Array.isArray(subFilters) && subFilters.length > 0;

  return {
    subFilters: hasSubFilters ? subFilters : [],
    selectedSubFilter: hasSubFilters ? "all" : undefined,
  };
};

module.exports = {
  DASHBOARD_KEYS,
  withSubFilters,
};
