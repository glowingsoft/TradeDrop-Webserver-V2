// services/userService.js
const { generateMeta, sendResponse, parsePaginationParams } = require("../../../helperUtils/responseUtil");
const userRepo = require("./usersRepository");
const { formatUserResponse } = require("../../../helperUtils/userResponseUtil");
const { userCache } = require("../../../config/nodeCache");
const { User } = require("../../../models/UserModel");
const { default: mongoose } = require("mongoose");
const { generate2FASecret, generateQRCode, verify2FAToken } = require("./twoFactorAuth");
const { buildKeywordQueryFromModels } = require("../../../helperUtils/dbUtils/queryUtil");
const { validatePhoneNumber } = require("../../../helperUtils/validationsUtil");
const { accountStatusEmailTemplate } = require("../../../helperUtils/emailTemplates");
const { sendEmailViaBrevo } = require("../../../helperUtils/emailUtil");
const { createOrSkipDevice } = require("../../../models/Devices");
const { formatAthletes } = require("./formator/formatAthletes");
const Category = require("@models/Category");

const APP_NAME = "TradeDrop App";
const getAllUsers = async ({ req }) => {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, status, userType = "user", categoryId, areaLabel } = req.query;

  const skip = (page - 1) * limit;

  const baseMatch = {
    "verificationStatus.email": "verified",
    "accountState.status": { $ne: "deleted" },
    "accountState.userType": userType,
  };

  if (categoryId) {
    baseMatch.crafts = new mongoose.Types.ObjectId(categoryId);
  }

  if (areaLabel) {
    baseMatch.areaLabel = areaLabel;
  }

  if (keyword?.trim()) {
    const keywordMatch = buildKeywordQueryFromModels([{ schema: User.schema }], keyword);

    Object.assign(baseMatch, keywordMatch);
  }

  const statusMatch = status ? { "accountState.status": status } : {};

  const pipeline = [
    {
      $match: baseMatch,
    },

    {
      $lookup: {
        from: "categories",
        localField: "crafts",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              image: {
                $concat: [process.env.S3_BASE_URL || "", "$image"],
              },
            },
          },
        ],
        as: "crafts",
      },
    },

    {
      $lookup: {
        from: "reviews",
        localField: "_id",
        foreignField: "objectUser",
        pipeline: [
          {
            $project: {
              rating: 1,
            },
          },
        ],
        as: "reviews",
      },
    },

    {
      $addFields: {
        averageRating: {
          $round: [
            {
              $ifNull: [{ $avg: "$reviews.rating" }, 0],
            },
            1,
          ],
        },
        totalReviews: {
          $size: "$reviews",
        },
      },
    },

    {
      $facet: {
        users: [
          ...(status ? [{ $match: statusMatch }] : []),

          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              accountState: 1,
              crafts: 1,
              profileIcon: 1,
              createdAt: 1,
              averageRating: 1,
              totalReviews: 1,
            },
          },

          {
            $sort: {
              createdAt: -1,
            },
          },

          {
            $skip: skip,
          },

          {
            $limit: limit,
          },
        ],

        total: [
          ...(status ? [{ $match: statusMatch }] : []),
          {
            $count: "count",
          },
        ],

        stats: [
          {
            $group: {
              _id: "$accountState.status",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];

  const [result] = await User.aggregate(pipeline);

  const users = result?.users || [];
  const totalFiltered = result?.total?.[0]?.count || 0;

  const stats = result?.stats || [];

  const meta = generateMeta(page, limit, totalFiltered);

  const getCount = (status) => stats.find((item) => item._id === status)?.count || 0;

  meta.counts = {
    pending: getCount("pending"),
    active: getCount("active"),
    rejected: getCount("rejected"),
    suspended: getCount("suspended"),
    inactive: getCount("inactive"),
  };

  meta.categories = [{ _id: null, name: "All" }, ...(await Category.find({}, { _id: 1, name: 1 }).lean())];

  meta.areas = await getUserAreaLabels();

  return {
    users,
    meta,
  };
};

const updateUser = async (req, res, options = {}) => {
  const { userId } = options;
  const {
    // email,
    phoneNumber,
    profileIcon,
    name,
    timezone,
    username,
    gender,
    dob,
    deviceId,
    deviceType,
    status,
    areaLabel,
    lat,
    lng,
  } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const userType = user.accountState.userType;

    // Validate profileIcon
    if (profileIcon && profileIcon.startsWith("http")) {
      return {
        errorCode: 400,
        message: "url_not_accepted",
        field: "profileIcon",
      };
    }

    /*   // Check if email exists
      const existingUser = await User.findOne({ _id: { $ne: userId }, email: email.trim().toLowerCase() });
      if (existingUser && existingUser.verificationStatus.email === "verified") {
        sendResponse({
          res,
          statusCode: 400,
          translationKey: "email_already",
        });
        return { responseSent: true };
      }
   */

    // Validate phone number if provided
    if (phoneNumber) {
      if (
        typeof phoneNumber !== "object" ||
        !phoneNumber.code ||
        !phoneNumber.number
        // !validatePhoneNumber(`${phoneNumber.code}${phoneNumber.number}`).valid
      ) {
        return { errorCode: 400, message: "invalid_phone" };
      }

      const existingPhone = await User.findOne({
        _id: { $ne: userId },
        "phoneNumber.code": phoneNumber.code,
        "phoneNumber.number": phoneNumber.number,
        "verificationStatus.phoneNumber": "verified",
      });

      if (existingPhone) {
        return { errorCode: 409, message: "phone_number_already" };
      }

      user.phoneNumber = phoneNumber;
      user.verificationStatus.phoneNumber = "pending";
    }

    if (name) user.name = name;
    if (profileIcon) user.profileIcon = profileIcon;
    if (timezone) user.timezone = timezone;
    if (username) user.username = username;
    if (gender) user.gender = gender;
    if (dob) user.dob = dob;
    if (status) user.accountState.status = status;
    if (areaLabel) user.areaLabel = areaLabel;
    if (lat) user.lat = lat;
    if (lng) user.lng = lng;

    await user.save({ session });

    // Device handling
    if (deviceId && deviceType) {
      createOrSkipDevice(user._id, deviceId, deviceType);
    }

    //if status is updated then send email to user
    // if (status) {
    //   const mBody = accountStatusEmailTemplate(status, user.name);
    //   await sendEmailViaBrevo([user.email], "Account Status", mBody);
    // }

    await session.commitTransaction();

    userCache.del(userId.toString());
    const userObject = user.toJSON();
    return formatUserResponse(userObject, null, [], ["resetToken"]);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const deleteUser = async (id) => {
  const updated = await userRepo.findByIdAndUpdate(id, {
    "accountState.status": "deleted",
  });
  if (!updated) return null;
  userCache.del(id.toString());
  return true;
};

const getUserDetails = async (id) => {
  return await userRepo.findUserById(id);
};

const getUserDetailsForQRService = async (id) => {
  let data = await userRepo.getUserDetailsForQRRepo(id);
  // let formattedData = data?.toObject?.() ?? data;
  // formattedData = ;
  return formatUserResponse(data, null, [], ["accountState", "preferences", "metadata"]);
};

/**
 * Setup 2FA (Generate QR and Secret, but do not enable yet)
 * @param {string} userId
 * @returns {Promise<{ qrCodeDataURL: string, secret: string }>}
 */
const setupTwoFA = async (userId) => {
  const user = await userRepo.findUserById(userId, { twoFA: 1, email: 1 });

  let secret = user.twoFA?.secret;
  if (!secret) {
    const { secret: newSecret } = generate2FASecret(APP_NAME, user.email);
    secret = newSecret;

    await userRepo.updateTwoFA(userId, {
      "twoFA.secret": secret,
      "twoFA.isEnabled": false,
      "twoFA.isConfirmed": false,
    });
  }

  const otpauth = `otpauth://totp/${encodeURIComponent(APP_NAME)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(APP_NAME)}`;
  const qrCodeDataURL = await generateQRCode(otpauth);

  return { qrCodeDataURL, secret };
};

/**
 * Confirm 2FA (Verify token and enable)
 * @param {string} userId
 * @param {string} token
 * @returns {Promise<boolean>}
 */
const confirmTwoFA = async (userId, token) => {
  const user = await userRepo.findUserById(userId, { twoFA: 1 });

  if (!user || !user.twoFA?.secret) {
    return { isValid: false, newlyEnabled: false };
  }

  const isValid = verify2FAToken(token, user.twoFA.secret);

  if (!isValid) {
    return { isValid: false, newlyEnabled: false };
  }

  const updatePayload = {
    "twoFA.isEnabled": true,
    "twoFA.isConfirmed": true,
    "twoFA.enabledAt": new Date(),
  };

  await userRepo.updateTwoFA(userId, updatePayload);

  userCache.del(userId.toString());

  return {
    isValid: true,
    newlyEnabled: !user.twoFA.isEnabled,
  };
};

/**
 * Disable 2FA
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
const disableTwoFA = async (userId) => {
  await userRepo.updateTwoFA(userId, {
    "twoFA.isEnabled": false,
    "twoFA.isConfirmed": false,
  });
  return true;
};

const getAllAthletes = async ({ page, limit, keyword, status = "active", userType = "user" }) => {
  const skip = (page - 1) * limit;

  const matchStage = {
    "verificationStatus.email": "verified",
  };

  if (status) {
    matchStage["accountState.status"] = status;
  } else {
    matchStage["accountState.status"] = { $ne: "deleted" };
  }

  if (userType !== undefined) {
    matchStage["accountState.userType"] = userType;
  }

  if (keyword && keyword.trim() !== "") {
    const keywordMatch = buildKeywordQueryFromModels([{ schema: User.schema }], keyword);

    Object.assign(matchStage, keywordMatch);
  }

  const pipeline = [
    {
      $match: matchStage,
    },

    {
      $lookup: {
        from: "bookings",
        localField: "_id",
        foreignField: "user",
        pipeline: [
          {
            $match: {
              bookingStatus: {
                $nin: ["deleted", "cancelled", "rejected"],
              },
            },
          },
          {
            $project: {
              _id: 1,
              bookingStatus: 1,
            },
          },
        ],
        as: "sessions",
      },
    },

    {
      $addFields: {
        totalSessions: {
          $size: "$sessions",
        },
      },
    },

    {
      $facet: {
        users: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              profileIcon: 1,
              accountState: 1,
              phoneNumber: 1,
              accountState: 1,
              createdAt: 1,
              totalSessions: 1,
            },
          },

          {
            $sort: {
              createdAt: -1,
            },
          },

          {
            $skip: skip,
          },

          {
            $limit: limit,
          },
        ],

        total: [
          {
            $count: "count",
          },
        ],
      },
    },
  ];

  const result = await User.aggregate(pipeline);

  const data = result[0] || {};

  const users = data.users || [];
  const totalFiltered = data.total?.[0]?.count || 0;

  const meta = generateMeta(page, limit, totalFiltered);

  return {
    users: formatAthletes(users),
    meta,
  };
};

const getUserAreaLabels = async () => {
  const areas = await userRepo.getDistinctAreaLabels();
  return [{ label: "All", value: null }, ...areas];
};

module.exports = {
  getAllUsers,
  updateUser,
  deleteUser,
  getUserDetails,
  setupTwoFA,
  confirmTwoFA,
  disableTwoFA,
  getUserDetailsForQRService,
  getAllAthletes,
  getUserAreaLabels,
};
