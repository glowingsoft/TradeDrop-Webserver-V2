/* ------------------------------------------
   CONSTANTS
------------------------------------------ */

const months = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
];

const ALL_REGIONS = [
  "Asia",
  "Europe",
  "Africa",
  "Americas",
  "Oceania",
  "Other"
];

/* ------------------------------------------
   HELPERS
------------------------------------------ */

const timezoneToRegion = (tz = "") => {
  if (tz.startsWith("Asia/")) return "Asia";
  if (tz.startsWith("Europe/")) return "Europe";
  if (tz.startsWith("Africa/")) return "Africa";
  if (
    tz.startsWith("America/") ||
    tz.startsWith("US/") ||
    tz.startsWith("Canada/")
  ) return "Americas";
  if (tz.startsWith("Australia/") || tz.startsWith("Pacific/"))
    return "Oceania";

  return "Other";
};

/* ------------------------------------------
   MAIN UTILITY
------------------------------------------ */

const buildUserDashboardAnalytics = (users = []) => {
  const now = new Date();

  /* -------- Initialize Buckets -------- */

  const ageBuckets = {
    "18-25": 0,
    "25-34": 0,
    "35-44": 0,
    "45-54": 0,
    "55+": 0
  };

  const genderCount = {
    Male: 0,
    Female: 0,
    Other: 0
  };

  const userGrowth = Array(12).fill(0);

  // Ensure ALL regions always exist
  const regionStats = {};
  ALL_REGIONS.forEach(region => {
    regionStats[region] = {
      males: 0,
      females: 0,
      others: 0
    };
  });

  /* ----------------------------------
     SINGLE PASS OVER USERS
  ---------------------------------- */

  for (const u of users) {
    /* -------- Growth -------- */
    if (u.createdAt) {
      const m = new Date(u.createdAt).getMonth();
      if (m >= 0 && m < 12) userGrowth[m]++;
    }

    /* -------- Gender Normalization -------- */
    const gender =
      u.gender === "Male" || u.gender === "Female" || u.gender === "Other"
        ? u.gender
        : "Unknown";

    if (gender !== "Unknown") {
      genderCount[gender]++;
    }

    /* -------- Age (DOB is STRING) -------- */
    if (u.dob && typeof u.dob === "string") {
      const dob = new Date(u.dob);
      if (!isNaN(dob)) {
        const age = Math.floor(
          (now - dob) / (365.25 * 24 * 60 * 60 * 1000)
        );

        if (age >= 18 && age < 25) ageBuckets["18-25"]++;
        else if (age < 35) ageBuckets["25-34"]++;
        else if (age < 45) ageBuckets["35-44"]++;
        else if (age < 55) ageBuckets["45-54"]++;
        else if (age >= 55) ageBuckets["55+"]++;
      }
    }

    /* -------- Region (Timezone-based) -------- */
    const region = timezoneToRegion(u.timezone);

    if (gender === "Male") regionStats[region].males++;
    else if (gender === "Female") regionStats[region].females++;
    else if (gender === "Other") regionStats[region].others++;
    else {
      // Unknown gender still counts toward region presence
      regionStats[region].others++;
    }
  }

  /* ----------------------------------
     FINAL SHAPING (UI-READY)
  ---------------------------------- */

  const totalGender =
    genderCount.Male + genderCount.Female + genderCount.Other || 1;

  return {
    /* -------- Age Demographics -------- */
    ageDemographics: Object.entries(ageBuckets).map(([ageGroup, total]) => ({
      ageGroup,
      total
    })),

    /* -------- Gender Analytics -------- */
    genderAnalytics: [
      {
        name: "Males",
        count: genderCount.Male,
        percent: Math.round((genderCount.Male / totalGender) * 100)
      },
      {
        name: "Females",
        count: genderCount.Female,
        percent: Math.round((genderCount.Female / totalGender) * 100)
      },
      {
        name: "Others",
        count: genderCount.Other,
        percent: Math.round((genderCount.Other / totalGender) * 100)
      }
    ],

    /* -------- Region Overview -------- */
    regionOverview: ALL_REGIONS.map(region => ({
      region,
      males: regionStats[region].males,
      females: regionStats[region].females,
      others: regionStats[region].others
    })),

    /* -------- User Growth -------- */
    userGrowth: months.map((month, index) => ({
      month,
      total: userGrowth[index]
    }))
  };
};

module.exports = {
  buildUserDashboardAnalytics
};
