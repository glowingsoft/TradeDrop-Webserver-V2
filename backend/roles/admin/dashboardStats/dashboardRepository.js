const { getDateRanges } = require("./utils/dashboardDate.utils");
const mongoose = require("mongoose");
const EngagementEvents = require("@appEngagement/EngagementEvents");
const { User } = require("@UsersModel");
const { calculateGrowth } = require("./utils/dashboardDate.utils");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");
const Message = require("../../../commonModules/chatModule/models/Message");
const moment = require("moment-timezone");

const { getFullImageUrl } = require("@helperUtils/imageHelper");
const SupportRequest = require("@SupportRequestModel");

const getMonthlyRevenueComparison = async (coachId = null) => {
  const now = new Date();
  const thisYear = now.getFullYear();
  const lastYear = thisYear - 1;

  const COMMISSION_RATE = 0.1; // 10% platform cut

  const getRevenueForYear = async (year) => {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);

    const matchStage = {
      createdAt: { $gte: start, $lt: end },
      "payment.status": "succeeded",
    };

    if (coachId) matchStage.coach = new mongoose.Types.ObjectId(coachId);

    const result = await Bookings.aggregate([
      { $match: matchStage },
      {
        $project: {
          month: { $month: "$createdAt" },
          amount: { $multiply: ["$payment.amount", COMMISSION_RATE] },
        },
      },
      {
        $group: {
          _id: "$month",
          totalRevenue: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return Array.from({ length: 12 }, (_, i) => {
      const monthData = result.find((r) => r._id === i + 1);
      return {
        month: i + 1,
        totalRevenue: monthData?.totalRevenue || 0,
      };
    });
  };

  const [thisYearRevenue, lastYearRevenue] = await Promise.all([
    getRevenueForYear(thisYear),
    getRevenueForYear(lastYear),
  ]);

  return { thisYearRevenue, lastYearRevenue };
};



const Genders = ["Male", "Female", "Other"];

const getUserGenderCounts = async () => {
  // Group by gender within a single collection
  const groupByGender = async (Model) => {
    const result = await Model.aggregate([
      {
        $group: {
          _id: "$gender",
          count: { $sum: 1 },
        },
      },
    ]);
    return result.reduce((acc, r) => {
      // Treat "" (unset) as "Other"
      const key = r._id && r._id.trim() ? r._id : "Other";
      acc[key] = (acc[key] || 0) + r.count;
      return acc;
    }, {});
  };

  const [coachCounts, athleteCounts] = await Promise.all([
    groupByGender(CoachOnboardingResponses),
    groupByGender(UsersOnboardingResponsesModel),
  ]);

  // Merge the three buckets across both collections
  const byGender = Genders.reduce((acc, g) => {
    acc[g] = (coachCounts[g] || 0) + (athleteCounts[g] || 0);
    return acc;
  }, {});

  const total = Object.values(byGender).reduce((sum, c) => sum + c, 0);

  return {
    total,
    byGender,
  };
};


const getStats = async ({ timezone, user, dateFilter = "thisMonth" }) => {
  const ranges = getDateRanges({ dateFilter, timezone });

  const getUserCount = async (role, range) => {
    const matchStage = {
      "verificationStatus.email": "verified",
      "accountState.status": "active",
      "accountState.userType": role, // 👈 adjust to your schema if needed (e.g. "accountState.accountType")
      ...(range ? { createdAt: { $gte: range.start, $lt: range.end } } : {}),
    };

    const pipeline = [
      {
        $match: matchStage,
      },
    ];

    // Only coaches must have an onboarding response

    if (role === "coach") {
      pipeline.push(
        {
          $lookup: {
            from: "coachonboardingresponses",

            localField: "_id",

            foreignField: "user",

            as: "coachOnboardingResponse",
          },
        },

        {
          $unwind: {
            path: "$coachOnboardingResponse",

            preserveNullAndEmptyArrays: false,
          },
        },
      );
    }
    // if (role === "user") {
    //   pipeline.push(
    //     {
    //       $lookup: {
    //         from: "usersonboardingresponses",

    //         localField: "_id",

    //         foreignField: "user",

    //         as: "usersonboardingresponses",
    //       },
    //     },

    //     {
    //       $unwind: {
    //         path: "$usersonboardingresponses",

    //         preserveNullAndEmptyArrays: false,
    //       },
    //     },
    //   );
    // }

    pipeline.push({
      $count: "count",
    });
    const result = await User.aggregate(pipeline);
    return result[0]?.count || 0;
  };
  const [totalCoaches, coachesThisMonth, totalAthletes, athletesThisMonth] =
    await Promise.all([
      getUserCount("coach", null),
      getUserCount("coach", ranges),
      getUserCount("user", null),
      getUserCount("user", ranges),
    ]);

  return {
    totalCoaches,
    coachesThisMonth: "+" + coachesThisMonth + " this month",
    totalAthletes,
    athletesThisMonth: "+" + athletesThisMonth + " this month",
  };
};

const getRecentUsers = async (limit = 10) => {
  const users = await User.find(
    {},
    {
      _id: 1,
      name: 1,
      email: 1,
      phoneNumber: 1,
      accountState: 1,
      profileIcon: 1,
      createdAt: 1,
    },
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return users.map((user) => ({
    ...user,
    profileIcon: getFullImageUrl(user.profileIcon),
  }));
};




module.exports = {
  getStats,
  getMonthlyRevenueComparison,
  getUserGenderCounts,
  getRecentUsers,
};
