// helperUtils/userResponseUtil.js

const { notify } = require("@appEngagement/engagementEventsRoutes");
const { createVerificationLink } = require("../models/UserModel");
const { getFullImageUrl } = require("@helperUtils/imageHelper");

const formatUserResponse = (userObject, token = null, includeFields = [], excludeFields = []) => {
  if (!userObject) return null;
  const subAdmin =
    userObject.orignalUserType === "subAdmin"
      ? {
          permissions: userObject.permissions,
          orignalUserType: userObject.orignalUserType,
          orignalSubAdminId: userObject.orignalSubAdminId,
        }
      : null;
  const pIcon = getFullImageUrl(userObject?.profileIcon) || null;
  const userType = userObject.accountState?.userType;
  // Construct basicInfo cleanly using conditionals
  const basicInfo = {
    _id: userObject._id,
    profileIcon: pIcon,
    name: userObject.name,
    email: userObject.email,
    phoneNumber: userObject.phoneNumber || "",
    language: userObject.language,
    country: userObject.country,
    isOnboardingCompletedDoc: userObject.onboarding,
  };

  // Main response object
  let response = {
    basicInfo,
    profile: {
      bio: userObject.profile?.bio || "",
      links: userObject.profile?.links || [],
      areaLabel: userObject.profile?.areaLabel || "",
      lat: userObject.profile?.lat || null,
      lng: userObject.profile?.lng || null,
    },
    accountState: {
      twoFactorAuth: userObject.twoFA?.isEnabled || false,
      userType: userType || "user",
      status: userObject.accountState?.status || "active",
      verificationStatus: {
        email: userObject.verificationStatus?.email || "pending",
        phoneNumber: userObject.verificationStatus?.phoneNumber || "pending",
      },
    },
    crafts: userObject.crafts || [],
    // ...(subAdmin ? { subAdmin } : {}),
    // Notifications: {
    //   email: userObject.notifications?.email ?? true,
    //   push: userObject.notifications?.push ?? true,
    //   bookingReminders: userObject.notifications?.bookingReminders ?? true,
    //   profileviews: userObject.notifications?.profileviews ?? true,
    //   messages: userObject.notifications?.messages ?? true,
    // },

    metadata: {
      timezone: userObject.timezone,
      createdAt: userObject.createdAt,
      updatedAt: userObject.updatedAt,
      __v: userObject.__v,
    },
  };

  if (userType == "user") {
    // basicInfo.dob = userObject.dob || "";
    // basicInfo.gender = userObject.gender || "";
  } else if (userType == "admin") {
    // Removed location for admin userType
  }

  // Include OTP info in dev only
  if (
    (process.env.NODE_ENV === "dev" || process.env.NODE_ENV === "mobileapps" || process.env.NODE_ENV === "localhost") &&
    userObject.otpInfo &&
    userObject.otpInfo.emailOtp.otp !== ""
  ) {
    response.otpInfo = userObject.otpInfo;
  }

  // Include email verification info in dev only
  if (
    (process.env.NODE_ENV === "dev" || process.env.NODE_ENV === "mobileapps" || process.env.NODE_ENV === "localhost") &&
    userObject.emailVerificationLink
  ) {
    response.emailVerification = createVerificationLink(userObject.emailVerificationLink);
  }

  // Include resetToken if available
  if (userObject.resetToken) {
    response.resetToken = userObject.resetToken;
  }

  // Add token if provided
  if (token) {
    response.token = token;
  }

  // Handle includeFields
  if (includeFields.length > 0) {
    const filtered = {};
    includeFields.forEach((field) => {
      if (response[field]) {
        filtered[field] = response[field];
      }
    });
    return filtered;
  }

  // Handle excludeFields
  if (excludeFields.length > 0) {
    excludeFields.forEach((fieldPath) => {
      const [mainField, subField] = fieldPath.split(".");
      if (subField) {
        if (response[mainField]) {
          delete response[mainField][subField];
        }
      } else {
        delete response[fieldPath];
      }
    });
  }

  return response;
};

//attach url to profile icon without any other formatting
const formatUserProfileIconOnly = (userObject) => {
  if (!userObject) return null;
  const pIcon = getFullImageUrl(userObject?.profileIcon) || null;
  userObject.profileIcon = pIcon;
  return userObject;
};

module.exports = {
  formatUserResponse,
  formatUserProfileIconOnly,
};
