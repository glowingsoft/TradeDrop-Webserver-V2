const { User } = require("@UsersModel");

// ---------------- USERS ----------------
const getUserStats = async () => {
  const getCount = async (Model, baseMatch, extra) => {
    const finalMatch = {
      ...baseMatch,
      ...extra,
    };

    return Model.countDocuments(finalMatch);
  };

  // =========================
  // 🚀 GLOBAL USERS (NO COACH)
  // =========================
  const baseMatch = {
    "accountState.status": { $ne: "deleted" },
    "verificationStatus.email": "verified",
  };

  return {
    totalUsersCurrent: await getCount(
      User,
      baseMatch,
      { "accountState.userType": "user" }
    ),

    totalUsersPrevious: 0,

    coachesCurrent: await getCount(
      User,
      baseMatch,
      { "accountState.userType": "coach" }
    ),

    coachesPrevious: 0,

    activeUsersCurrent: await getCount(
      User,
      baseMatch,
      {
        "accountState.userType": "user",
        "accountState.status": "active",
      }
    ),

    activeUsersPrevious: 0,
  };
};

module.exports = {
  getUserStats,

};