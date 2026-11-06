const {
  sendResponse,
  parsePaginationParams,
  validateParams,
  generateMeta,
  getReadableErrorMessage,
} = require("../../../helperUtils/responseUtil.js");
const { User } = require("@UsersModel");

const { formatUserResponse } = require("../../../helperUtils/userResponseUtil.js");
const usersService = require("./usersService.js");
const { registerUserUtility } = require("../../../controllers/authUtil.js");
const { portfolioItemView } = require("@helperUtils/portfolioUtil");
const badgesService = require("../badges/badgesService");
const { getAllReviews: getAllTapInReviews } = require("@backend/roles/user/trades/service.js");
const Connection = require("@models/Connection");

const createUser = async (req, res) => {
  const result = await registerUserUtility(req, res, {
    autoVerify: true,
  });

  if (result.responseSent) return;

  if (!result.success) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: result.error.translationKey,
      error: result.error,
    });
  }

  return sendResponse({
    res,
    statusCode: 201,
    translationKey: "signup_successful",
    data: result.user,
  });
};

const getAllUsers = async (req, res) => {
  const currentUser = req.user;

  if (currentUser.userType === "admin") {
    // Admin can see all users
    try {
      const { users, meta } = await usersService.getAllUsers({
        req,
      });
      // // Ensure toJSON method is applied to strip out sensitive data
      // const sanitizedUsers = users.map((user) => {
      //   // Use your updated toJSON (works for docs and plain objects)
      //   return formatUserResponse(User.prototype.toJSON(user));
      // });

      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "users_fetched_successfully",
        data: users,
        meta,
      });
    } catch (error) {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "internal_server",
        error,
      });
    }
  }
};
const getUsers = async (req, res) => {
  const currentUser = req.user;
  if (currentUser.userType === "admin") {
    // Admin can see all users
    try {
      const { users, meta } = await usersService.getAllUsers({
        req,
      });
      // Ensure toJSON method is applied to strip out sensitive data
      const sanitizedUsers = users.map((user) => {
        // Use your updated toJSON (works for docs and plain objects
        return formatUserResponse(User.prototype.toJSON(user));
      });

      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "users_fetched_successfully",
        data: sanitizedUsers,
        meta,
      });
    } catch (error) {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "internal_server",
        error,
      });
    }
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;

  if (
    !validateParams(req, res, {
      pathParams: ["id"],
      objectIdFields: ["id"],
    })
  )
    return;

  try {
    const currentUser = req.user;

    // Only admin can update other users' profiles
    if (currentUser._id.toString() !== id && !["admin"].includes(currentUser.userType)) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "unauthorized_to_perform_this_action",
      });
    }
    const result = await usersService.updateUser(req, res, { userId: id });

    if (result && result.errorCode) {
      return sendResponse({
        res,
        statusCode: result.errorCode,
        translationKey: result.message,
        values: result.field ? { field: result.field } : undefined,
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_profile_updated_successfully",
      data: result,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "user_profile_update_error",
      values: { errorMessage: error.message },
      error,
    });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (
    !validateParams(req, res, {
      pathParams: ["id"],
      objectIdFields: ["id"],
    })
  )
    return;

  try {
    const deleted = await usersService.deleteUser(id);
    if (!deleted) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not_found",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_deleted_successfully",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};

const getUserDetails = async (req, res) => {
  const { id } = req.params;
  if (
    !validateParams(req, res, {
      pathParams: ["id"],
      objectIdFields: ["id"],
    })
  )
    return;

  try {
    let user = await usersService.getUserDetails(id);

    if (!user) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_details_not_found",
      });
    }

    let userObject = new User(user).toJSON();

    const response = formatUserResponse(userObject);
    response.profile.links = userObject.links || [];
    response.portfolioItems = (user.toObject().portfolioItems || []).map((item) =>
      portfolioItemView(item, { fullUrls: true }),
    );

    const [relationshipStats] = await Connection.aggregate([
      {
        $match: {
          status: "active",
          $or: [{ userA: userObject._id }, { userB: userObject._id }],
        },
      },
      {
        $group: {
          _id: null,
          connectionsCount: { $sum: 1 },
          collaborationsCount: { $sum: "$completedCount" },
        },
      },
    ]);
    response.relationshipStats = {
      connectionsCount: relationshipStats?.connectionsCount || 0,
      collaborationsCount: relationshipStats?.collaborationsCount || 0,
    };

    try {
      response.badges = await badgesService.listUserBadges(id);
    } catch (_) {
      response.badges = [];
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_fetched_successfully",
      data: response,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};

const getUserReviews = async (req, res) => {
  try {
    const result = await getAllTapInReviews({ req });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_reviews_fetched_successfully",
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};

// Setup 2FA (get QR code and secret)
const setupTwoFAController = async (req, res) => {
  const user = req.user;
  try {
    const result = await usersService.setupTwoFA(user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "2fa_setup",
      data: {
        qrCode: result.qrCodeDataURL,
        secret: result.secret,
      },
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error: error });
  }
};
// Confirm 2FA
const confirmTwoFAController = async (req, res) => {
  const user = req.user;
  const { token } = req.body;

  try {
    const { isValid, newlyEnabled } = await usersService.confirmTwoFA(user._id, token);

    if (!isValid) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_2fa_token",
      });
    }

    if (newlyEnabled) {
      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "2fa_enabled_successfully", // First time enabling
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "2fa_verified_successfully", // Already enabled, just validated
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};

// Disable 2FA
const disableTwoFAController = async (req, res) => {
  const user = req.user;
  try {
    await usersService.disableTwoFA(user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "2fa_disabled_successfully",
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const getAllAthletes = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const { keyword, status, userType } = req.query;
  const currentUser = req.user;

  if (currentUser.userType === "admin") {
    // Admin can see all users
    try {
      const { users, meta } = await usersService.getAllAthletes({
        page,
        limit,
        keyword,
        status,
        userType,
      });

      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "users_fetched_successfully",
        data: users,
        meta,
      });
    } catch (error) {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "internal_server",
        error,
      });
    }
  } else if (["manager", "organizer"].includes(currentUser.userType)) {
    // Managers and Organizers can see users they created or users in their organizations
    try {
      //only staff, manager userTypes accepted

      if (
        !validateParams(req, res, {
          enumFields: { userType: ["staff", "manager"] },
        })
      )
        return;

      // Managers and Organizers can only see users they created or users in their organizations
      const { users, meta } = await usersService.getStaff({
        page,
        limit,
        keyword,
        status,
        userType,
        currentUser,
      });

      // Filter users to only include those created by currentUser or in their organizations
      const filteredUsers = users.filter((user) => {
        if (currentUser.userType === "organizer") {
          // Organizer: users in orgs they created
          return user.organizations?.some((org) => org.creator.toString() === currentUser._id.toString());
        }

        if (currentUser.userType === "manager") {
          // Manager: users in orgs where they're listed in staff
          return user.organizations?.some((org) =>
            org.staff.some((s) => s.user.toString() === currentUser._id.toString()),
          );
        }

        return false;
      });

      // Ensure toJSON method is applied to strip out sensitive data
      const sanitizedUsers = filteredUsers.map((user) => {
        // Use your updated toJSON (works for docs and plain objects)
        return formatUserResponse(User.prototype.toJSON(user));
      });

      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "users_fetched_successfully",
        data: sanitizedUsers,
        meta,
      });
    } catch (error) {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "internal_server",
        error,
      });
    }
  }
};

module.exports = {
  createUser,
  getUsers,
  updateUser,
  setupTwoFAController,
  confirmTwoFAController,
  disableTwoFAController,
  deleteUser,
  getUserDetails,
  getUserReviews,
  getAllUsers,
  getAllAthletes,
};
