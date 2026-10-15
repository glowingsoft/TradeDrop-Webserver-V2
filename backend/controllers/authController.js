const { User, generateResetToken, USER_TYPES } = require("../models/UserModel");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const bcrypt = require("bcryptjs");
const {
  sendResponse,
  validateParams,
  getReadableErrorMessage,
} = require("../helperUtils/responseUtil");
const { formatUserResponse } = require("../helperUtils/userResponseUtil");
const { sendEmailViaBrevo } = require("../helperUtils/emailUtil");
const {
  forgotPasswordViaLinkEmailTemplate,
  registrationViaLinkEmailTemplate,
  forgotPasswordViaOtpEmailTemplate,
  OTP_PURPOSE_CONFIG,
  otpEmailTemplate,
} = require("../helperUtils/emailTemplates");
const { createOrSkipDevice, Devices } = require("../models/Devices");
const validator = require("validator");
const crypto = require("crypto");
const { registerUserUtility } = require("./authUtil");
const { validatePhoneNumber } = require("../helperUtils/validationsUtil");

const createAdmin = async (req, res) => {
  try {
    // Whitelist both localhost + your public IP
    const allowedIPs = ["223.123.44.6", "127.0.0.1", "::1", "192.168.15.40"];

    // Express behind reverse proxies (like Nginx)
    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    )
      .split(",")[0]
      .trim()
      .replace("::ffff:", "");

    if (!allowedIPs.includes(ip)) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "forbidden",
      });
    }

    // Require internal admin secret key (backend only)
    const key = req.headers["x-admin-access-token-signup"];
    if (key !== process.env.ADMIN_ACCESS_TOKEN_SIGNUP) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "unauthorized_admin_signup",
      });
    }

    //validation
    const validationOptions = {
      rawData: [
        "email",
        "name",
        "password",
        "timezone",
        "deviceType",
        "deviceId",
      ],
      minLengthFields: {
        password: 6, // Password must be at least 6 characters long
      },
    };
    if (!validateParams(req, res, validationOptions)) {
      return;
    }

    const {
      email,
      name,
      profileIcon,
      password,
      timezone,
      deviceId,
      deviceType,
    } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "admin_already_exists",
      });
    }

    const user = new User({
      email,
      profileIcon,
      name,
      password,
      timezone,
      accountState: { userType: "admin", status: "active" },
      verificationStatus: { email: "verified", phoneNumber: "verified" },
    });

    await user.save();

    //deviceId and deviceToken store in db
    if (
      typeof deviceId === "string" &&
      deviceId.trim() &&
      deviceId !== "test" &&
      typeof deviceType === "string"
    ) {
      createOrSkipDevice(user._id, deviceId.trim(), deviceType);
    }

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "admin_created_successfully",
    });
  } catch (err) {
    console.error("Error in createAdmin:", err);
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
    });
  }
};

//register
const register = async (req, res) => {
  const result = await registerUserUtility(req, res, {
    autoVerify: false,
  });

  if (result.responseSent) return;

  if (!result.success) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: result.error.translationKey,
      message: result.error.message,
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

const companyDetails = async (req, res) => {
  const {
    logo,
    coverImage,
    description,
    category,
    name,
    oib,
    bankAccountNumber,
    representativeName,
    location,
    suppliers,
  } = req.body;

  try {
    // Find the user by id (assumes authentication middleware sets req.user)
    const user = await User.findById(req.user._id).select("companyDetails");

    if (!user.companyDetails) {
      const validationOptions = {
        rawData: [
          "name",
          "oib",
          "bankAccountNumber",
          "representativeName",
          "location",
        ],
      };
      if (!validateParams(req, res, validationOptions)) {
        return;
      }
    }

    // Update only provided company details, keep existing fields if not provided
    user.companyDetails = {
      logo: logo !== undefined ? logo : user.companyDetails?.logo,
      coverImage:
        coverImage !== undefined ? coverImage : user.companyDetails?.coverImage,
      description:
        description !== undefined
          ? description
          : user.companyDetails?.description,
      category:
        category !== undefined ? category : user.companyDetails?.category,
      name: name !== undefined ? name : user.companyDetails?.name,
      oib: oib !== undefined ? oib : user.companyDetails?.oib,
      bankAccountNumber:
        bankAccountNumber !== undefined
          ? bankAccountNumber
          : user.companyDetails?.bankAccountNumber,
      representativeName:
        representativeName !== undefined
          ? representativeName
          : user.companyDetails?.representativeName,
      location:
        location !== undefined ? location : user.companyDetails?.location,
      suppliers:
        suppliers !== undefined ? suppliers : user.companyDetails?.suppliers,
    };

    await user.save();

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "company_details_saved",
      data: user.companyDetails,
    });
  } catch (error) {
    const readableError = getReadableErrorMessage(error);
    return sendResponse({
      res,
      statusCode: readableError.statusCode,
      translationKey: readableError.message,
      error,
    });
  }
};

//login
const login = async (req, res) => {
  try {
    const { email, password, deviceId, deviceType, timezone, userType } =
      req.body;
    const validationOptions = {
      rawData: [
        "email",
        "password",
        "deviceId",
        "deviceType",
        "timezone",
        "userType",
      ],
      enumFields: {
        userType: User.USER_TYPES,
      },
    };
    if (!validateParams(req, res, validationOptions)) {
      return;
    }
    let populateFields = [];

    const user = await User.findByCredentials(
      email,
      password,
      userType,
      timezone,
      populateFields,
    );

    // Check if an error occurred
    if (user.error) {
      if (user.error === "user_not_found") {
        return sendResponse({
          res,
          statusCode: 404,
          translationKey: "user_not_found", // Use your translation key for user not found
        });
      } else if (user.error === "incorrect_password") {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "incorrect_password", // Use your translation key for incorrect password
        });
      }
    }
    
    // Restrict admin login
    if (user.accountState.userType === "admin") {
      const adminCreationToken = req.header("x-admin-access-token");
      if (adminCreationToken === process.env.ADMIN_ACCESS_TOKEN) {
      } else {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "unauthorized_to_1",
        });
      }
    }

    // Check the user's verification status
    const verificationStatus = user.verificationStatus["email"];
    if (verificationStatus === "pending") {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "your_account",
      });
    }

    if (user.accountState.status === "pending") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "pending_approval",
      });
    }

    if (user.accountState.status === "rejected") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "rejected_verification",
        data: {
          reason: user.accountState.reason || "No reason provided",
        },
      });
    }

    if (
      user.accountState.status === "suspended" ||
      user.accountState.status === "deleted" ||
      user.accountState.status === "inactive"
    ) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "your_account_2",
      });
    }

    // Update the user's timezone
    user.timezone = timezone;

    // Ensure toJSON method is applied to strip out sensitive data
    const userObject = user.toJSON();
    const token = user.generateAuthToken();


    // Format the user response using the utility function
    let response = formatUserResponse(userObject, token, [], ["resetToken"]);
    //deviceId and deviceToken store in db
    if (
      typeof deviceId === "string" &&
      deviceId.trim() &&
      deviceId !== "test" &&
      typeof deviceType === "string"
    ) {
      // Save device information (not part of the transaction)
      createOrSkipDevice(userObject._id, deviceId, deviceType);
    } else {
      console.warn("FCM Token information not saved due to invalid input");
    }

    // Send successful response with token and user data
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "login_success",
      data: response,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: error,
      error,
    });
  }
};
//loginTest
const loginTest = async (req, res) => {
  try {
    const { email, userType } = req.body;
    const validationOptions = {
      rawData: ["email", "userType"],
      enumFields: {
        userType: User.USER_TYPES,
      },
    };
    if (!validateParams(req, res, validationOptions)) {
      return;
    }
    let populateFields = [];

    const user = await User.findOne({
      email,
      "accountState.userType": userType,
    });

    // Check if an error occurred
    if (!user) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not_found", // Use your translation key for user not found
      });
    }

    // Restrict admin login
    if (user.accountState.userType === "admin") {
      const adminCreationToken = req.header("x-admin-access-token");
      if (adminCreationToken === process.env.ADMIN_ACCESS_TOKEN) {
      } else {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "unauthorized_to_1",
        });
      }
    }

    // Check the user's verification status
    const verificationStatus = user.verificationStatus["email"];
    if (verificationStatus === "pending") {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "your_account",
      });
    }

    if (user.accountState.status === "pending") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "pending_approval",
      });
    }

    if (user.accountState.status === "rejected") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "rejected_verification",
        data: {
          reason: user.accountState.reason || "No reason provided",
        },
      });
    }

    if (user.accountState.status === "suspended") {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "your_account_2",
      });
    }

    const token = user.generateAuthToken();

    // Ensure toJSON method is applied to strip out sensitive data
    const userObject = user.toJSON();

    // Format the user response using the utility function
    const response = formatUserResponse(
      userObject,
      token,
      [],
      ["resetToken", "organizations"],
    );

    // Send successful response with token and user data
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "login_success",
      data: response,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: error,
      error,
    });
  }
};

// Generate OTP
const generateOtp = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { email, phoneNumber, type, purpose = "generic" } = req.body;

    const validationOptions = {
      rawData: [type === "email" ? "email" : "phoneNumber"],
    };

    if (!validateParams(req, res, validationOptions)) return;

    // Validate phone number
    if (
      type === "phoneNumber" &&
      phoneNumber &&
      (typeof phoneNumber !== "object" ||
        !phoneNumber.code ||
        !phoneNumber.number ||
        !validatePhoneNumber(`${phoneNumber.code}${phoneNumber.number}`).valid)
    ) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_phone",
      });
    }

    // Load user
    let user;
    if (type === "email") {
      user = await User.findOne({ email: email.toLowerCase() }).select(
        "email accountState otpInfo timezone",
      );
    } else {
      user = await User.findOne({
        "phoneNumber.code": phoneNumber.code,
        "phoneNumber.number": phoneNumber.number,
      }).select("phoneNumber accountState otpInfo timezone");
    }

    if (!user) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not",
      });
    }

    // Account state check
    if (["restricted", "suspended"].includes(user.accountState.status)) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "your_account_4",
      });
    }

    // Generate OTP (should internally store purpose)
    const otp = user.generateOtp(type, user.timezone, purpose);

    if (otp?.error === "too_many_otp_requests") {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "too_many_otp_requests",
      });
    }

    await user.save({ session });

    // Commit BEFORE sending email/SMS
    await session.commitTransaction();
    session.endSession();

    // -----------------------------
    // 📩 Send OTP (outside txn)
    // -----------------------------
    const config = OTP_PURPOSE_CONFIG[purpose] || OTP_PURPOSE_CONFIG.generic;

    if (type === "email") {
      const subject = config.subject;

      const mBody = otpEmailTemplate({
        otp,
        title: config.title,
        message: config.message,
      });

      await sendEmailViaBrevo([email], subject, mBody);
    }
    // Only include OTP in dev environment
    if (
      (process.env.NODE_ENV === "dev" ||
        process.env.NODE_ENV === "mobileapps" ||
        process.env.NODE_ENV === "localhost") &&
      otp
    ) {
      return sendResponse({
        res,
        statusCode: 201,
        translationKey: "otp_generated",
        data: {
          otp,
        },
      });
    } else {
      return sendResponse({
        res,
        statusCode: 201,
        translationKey: "otp_generated",
      });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

//Verify otp
const verifyOtp = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { email, phoneNumber, type, otp } = req.body;

    const validationOptions = {
      rawData: [type === "email" ? "email" : "phoneNumber"],
    };

    if (type === "email") {
      validationOptions.rawData.push("otp");
    }

    if (!validateParams(req, res, validationOptions)) {
      await session.abortTransaction();
      return;
    }

    if (
      type === "phoneNumber" &&
      phoneNumber &&
      (typeof phoneNumber !== "object" ||
        !phoneNumber.code ||
        !phoneNumber.number ||
        !validatePhoneNumber(`${phoneNumber.code}${phoneNumber.number}`).valid)
    ) {
      await session.abortTransaction();

      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_phone",
      });
    }

    let user;

    if (type === "email") {
      user = await User.findOne({ email: email.toLowerCase() })
        .select(
          "email accountState otpInfo verificationStatus timezone resetToken",
        )
        .session(session);
    }

    if (type === "phoneNumber") {
      user = await User.findOne({
        "phoneNumber.code": phoneNumber.code,
        "phoneNumber.number": phoneNumber.number,
      })
        .select(
          "phoneNumber accountState otpInfo verificationStatus timezone resetToken",
        )
        .session(session);
    }

    if (!user) {
      await session.abortTransaction();

      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not",
      });
    }

    const userOtpInfo =
      type === "email" ? user.otpInfo.emailOtp : user.otpInfo.phoneNumberOtp;

    if (type === "email") {
      if (userOtpInfo.otp !== otp.toString()) {
        await session.abortTransaction();

        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "invalid_otp",
        });
      }

      const currentTime = moment.tz(Date.now(), user.timezone).valueOf();

      if (userOtpInfo.otpExpires && userOtpInfo.otpExpires < currentTime) {
        await session.abortTransaction();

        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "otp_has",
        });
      }
    }

    userOtpInfo.otp = "";
    userOtpInfo.otpExpires = "";
    userOtpInfo.otpUsed = true;

    user.verificationStatus[type] = "verified";

    const resetToken = generateResetToken();
    user.resetToken = resetToken;

    await user.save({ session });

    await session.commitTransaction();

    const updatedUser = await User.findById(user._id).lean();

    const token = user.generateAuthToken();

    let response = formatUserResponse(updatedUser, token);

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_verified",
      data: response,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Error during OTP verification:", error);

    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "an_error",
      error,
    });
  } finally {
    session.endSession();
  }
};

const verifyEmailViaLink = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "missing_token",
    });
  }

  // Hash the token from the URL
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Find user by hashed token
  const user = await User.findOne({
    "emailVerification.tokenHash": tokenHash,
  });

  if (!user) {
    return sendResponse({
      res,
      statusCode: 404,
      translationKey: "invalid_or_expired_verification_link",
    });
  }

  const { expiresAt, used } = user.emailVerification;

  if (used) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "verification_link_already_used",
    });
  }

  if (Date.now() > expiresAt) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "verification_link_expired",
    });
  }

  // Mark verified
  user.verificationStatus.email = "verified";
  user.emailVerification.used = true;
  user.emailVerification.otpRequestCount = 0;
  await user.save();

  return res.redirect(
    `${process.env.EMAIL_VERIFICATION_REDIRECT_URL}?verification=success`,
  );
};

const resendEmailVerificationLink = async (req, res) => {
  try {
    const { email } = req.body;

    // Find the user by email
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not_found",
      });
    }

    // Generate a new email verification token
    const tokenData = user.generateEmailVerificationToken();
    if (tokenData.error) {
      //too_many_verification_requests
      if (tokenData.error === "too_many_verification_requests") {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "too_many_verification_requests",
        });
      }
    }

    await user.save();

    // Send the verification email
    const mBody = registrationViaLinkEmailTemplate(tokenData.verificationLink);
    await sendEmailViaBrevo([user.email], "Email Verification", mBody);

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "verification_email_sent",
      data: { verificationLink: tokenData.verificationLink },
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error: error,
    });
  }
};

//sends link to email
const sendPasswordResetLink = async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    return sendResponse({
      res,
      statusCode: 404,
      translationKey: "user_not_found",
    });
  }

  const tokenData = user.generatePasswordResetToken();

  if (tokenData.error) {
    //too_many_password_reset_requests
    if (tokenData.error === "too_many_password_reset_requests") {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "too_many_password_reset_requests",
      });
    }
  }

  await user.save();

  const mBody = forgotPasswordViaLinkEmailTemplate(tokenData.resetLink);
  await sendEmailViaBrevo([user.email], "Password Reset", mBody);

  return sendResponse({
    res,
    statusCode: 200,
    translationKey: "password_reset_link_sent",
    data: { resetLink: tokenData.resetLink },
  });
};

// when user clicks on link from email inbox
const verifyPasswordResetLink = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "missing_token",
    });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({ "passwordReset.tokenHash": tokenHash });
  if (
    !user ||
    user.passwordReset.used ||
    Date.now() > user.passwordReset.expiresAt
  ) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "invalid_or_expired_link",
    });
  }

  // Redirect to your frontend's reset password form
  return res.redirect(`${process.env.PASSWORD_RESET_FRONTEND_URL}${token}`);
};

//
const resetPasswordViaLink = async (req, res) => {
  const { token, newPassword } = req.body;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({ "passwordReset.tokenHash": tokenHash });
  if (
    !user ||
    user.passwordReset.used ||
    Date.now() > user.passwordReset.expiresAt
  ) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "invalid_or_expired_link",
    });
  }

  // Set new password
  user.password = newPassword;
  user.passwordReset.used = true;
  user.passwordReset.otpRequestCount = 0;
  await user.save();

  return sendResponse({
    res,
    statusCode: 200,
    translationKey: "password_reset_successful",
  });
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { email, newPassword, resetToken } = req.body;

    const validationOptions = {
      rawData: ["email", "newPassword", "resetToken"],
    };
    if (!validateParams(req, res, validationOptions)) {
      return;
    }

    // Find the user by email
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
      resetToken: resetToken,
    });

    if (!user) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "no_valid",
      });
    }

    // Update the password and mark OTP as used
    user.password = newPassword;
    user.otpInfo.otpUsed = true; // Mark OTP as used
    user.otpInfo.otp = ""; // Clear OTP
    user.otpInfo.otpExpires = ""; // Clear OTP expiration
    user.resetToken = ""; // Clear OTP token

    await user.save();

    // Fetch the updated user with profile icon populated and generate a token simultaneously
    const [updatedUser, token] = await Promise.all([
      User.findById(user._id),
      user.generateAuthToken(),
    ]);

    // Apply toJSON method to strip out sensitive data
    const userObject = updatedUser.toJSON();

    // Format the user response using the utility function
    const response = formatUserResponse(userObject, token);

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "password_has",
      data: response,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "an_error_1",
      error: error,
    });
  }
};

const logout = async (req, res) => {
  try {
    const { deviceId } = req.body;
    const userId = req.user._id;

    // Use $pull to remove the specific device from the devices array
    await Devices.updateOne(
      { userId: userId }, // Find the user by userId
      { $pull: { devices: { deviceId: deviceId } } }, // Remove the device with matching deviceId
    );

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "logged_out",
    });
  } catch (err) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: err.message,
      error: err.message,
    });
  }
};

const hardDeleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    const email = req.user.email;

    // Generate a random email using the userId and original email
    const randomEmail = `deleted_user_${userId}_${Date.now()}@example.com`;

    // Update the user's account state to deleted and set the finalDeletionDate
    await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          email: randomEmail, // replace with random email
          previousEmail: email, // store the original email
          phoneNumber: { code: "", number: "" }, // clear phone number object
          profileIcon: "noimage.png",
          "accountState.status": "deleted",
        },
      },
      { new: true },
    );

    await Devices.updateOne(
      { userId: userId },
      { $set: { devices: [] } }, // This will empty the array of devices for the user
    );

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "account_deleted",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error: error,
    });
  }
};

const socialAuth = async (req, res) => {
  let {
    provider,
    socialId,
    email,
    name,
    deviceId,
    deviceType,
    timezone,
    userType,
  } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validationOptions = {
      rawData: [
        "provider",
        "socialId",
        "name",
        "deviceId",
        "deviceType",
        "timezone",
        "userType",
      ],
      enumFields: {
        provider: ["google", "facebook", "apple"], // Allowed values for provider
        userType: ["user", "coach"],
      },
    };

    if (!validateParams(req, res, validationOptions)) {
      return;
    }

    //if no email is provided, then create it from socialId
    if (!email) {
      if (provider === "google") {
        email = `${socialId}@google.com`;
      } else if (provider === "facebook") {
        email = `${socialId}@facebook.com`;
      } else if (provider === "apple") {
        email = `${socialId}@apple.com`;
      }
    }

    if (!validator.isEmail(email)) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_email",
        values: { field: "email" },
      });
    }

    // after email normalize
    email = email.trim().toLowerCase();

    const providerIdField = `${provider}Id`;

    // 1. First find by provider id
    let existingUser = await User.findOne({
      [providerIdField]: socialId,
    }).session(session);

    // 2. If not found, find by email
    if (!existingUser) {
      existingUser = await User.findOne({ email }).session(session);
    }

    // 3. If email exists, link provider and login
    if (existingUser) {
      if (existingUser.accountState.userType !== userType) {
        await session.abortTransaction();
        session.endSession();

        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "email_already_registered_as_different_user_type",
        });
      }

      if (existingUser.accountState.status === "suspended") {
        await session.abortTransaction();
        session.endSession();

        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "your_account_2",
        });
      }

      const updateData = {
        provider,
        timezone,
        "accountState.status": "active",
        "verificationStatus.email": "verified",
      };

      if (!existingUser[providerIdField]) {
        updateData[providerIdField] = socialId;
      }

      existingUser = await User.findByIdAndUpdate(
        existingUser._id,
        { $set: updateData },
        { new: true, session }
      );


      const token = existingUser.generateAuthToken();

      // Ensure toJSON method is applied to strip out sensitive data
      const userObject = existingUser.toJSON();

      const response = formatUserResponse(userObject, token);

      if (
        typeof deviceId === "string" &&
        deviceId.trim() &&
        deviceId !== "test" &&
        typeof deviceType === "string"
      ) {
        // Save device information
        createOrSkipDevice(existingUser._id, deviceId, deviceType);
      }

      await session.commitTransaction();
      session.endSession();

      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "login_success",
        data: response,
      });
    } else {
      // If user does not exist, treat this as a signup
      const newUser = new User({
        email,
        name,
        provider, // Set the initial provider
        [`${provider}Id`]: socialId, // Dynamically store the provider ID
        timezone,
        verificationStatus: {
          email: "verified", // Mark email as verified
        },
        accountState: { userType: userType, status: "active" },
      });

      try {
        await newUser.save({ session });
      } catch (error) {
        if (error.code === 11000 && error.keyPattern?.email) {
          await session.abortTransaction();
          session.endSession();

          return sendResponse({
            res,
            statusCode: 409,
            translationKey: "email_already_exists_try_login",
          });
        }

        throw error;
      }

      // Generate a token for the new user
      const token = newUser.generateAuthToken();

      const jUser = newUser.toJSON();
      const response = formatUserResponse(jUser, token);

      if (
        typeof deviceId === "string" &&
        deviceId.trim() &&
        deviceId !== "test" &&
        typeof deviceType === "string"
      ) {
        // Save device information
        createOrSkipDevice(newUser._id, deviceId, deviceType);
      }

      await session.commitTransaction();
      session.endSession();

      return sendResponse({
        res,
        statusCode: 201,
        translationKey: "signup_successful",
        data: response,
      });
    }
  } catch (error) {
    // Rollback transaction in case of any error
    await session.abortTransaction();
    session.endSession();
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error: error,
    });
  }
};

//check if email already exists and verified
const checkEmailExistsAndVerified = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "missing_email",
      });
    }
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("verificationStatus");
    const existsAndVerified = !!(
      user && user.verificationStatus.email === "verified"
    );
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "email_check_success",
      data: { exists: existsAndVerified },
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error,
    });
  }
};

//changePassword api which takes old password and new password
const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const userId = new mongoose.Types.ObjectId(req.user._id);


    const validationOptions = {
      rawData: ["oldPassword", "newPassword"],
      minLengthFields: {
        newPassword: 6, // New password must be at least 6 characters long
      },
    };
    if (!validateParams(req, res, validationOptions)) {
      return;
    }
    const user = await User.findById(userId).select("password");

    if (!user) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not_found",
      });
    }

    // Check if the old password is correct using bcrypt
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "incorrect_old_password",
      });
    }

    // Update the password
    user.password = newPassword;
    await user.save();

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "password_changed_successfully",
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "an_error_occurred",
      error,
    });
  }
};

module.exports = {
  createAdmin,
  register,
  companyDetails,
  login,
  generateOtp,
  verifyOtp,
  verifyEmailViaLink,
  resendEmailVerificationLink,
  sendPasswordResetLink,
  verifyPasswordResetLink,
  resetPasswordViaLink,
  resetPassword,
  logout,
  hardDeleteAccount,
  socialAuth,
  checkEmailExistsAndVerified,
  changePassword,
  loginTest,
};
