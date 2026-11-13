const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const moment = require("moment-timezone");
const validator = require("validator");
const { randomBytes } = require("crypto");
const { generateSecureToken } = require("../helperUtils/secureToken");
const { createVerificationLink, createResetPasswordLink, generateResetToken } = require("./userModelHelpers");
const { MAX_PORTFOLIO_IMAGES } = require("../helperUtils/portfolioUtil");

const USER_TYPES = ["guest", "user", "admin"];

const userSchema = new mongoose.Schema(
  {
    profileIcon: {
      type: String,
      default: "",
    },
    coverImage: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },

    dob: {
      type: String,
      default: "",
    },

    referralCode: {
      type: String,
      default: "",
    },

    email: {
      type: String,
      required: [true, "email_required"], // Generic error message key
      unique: true,
      validate: {
        validator: function (value) {
          return validator.isEmail(value);
        },
        message: "email_invalid", // Generic error message key
      },
    },
    emailVerification: {
      tokenHash: String,
      expiresAt: Number,
      used: {
        type: Boolean,
        default: false,
      },
      otpRequestCount: {
        type: Number,
        default: 0,
      },
      otpRequestTimestamp: {
        type: Date,
        default: Date.now,
      },
    },

    passwordReset: {
      tokenHash: String,
      expiresAt: Number,
      used: {
        type: Boolean,
        default: false,
      },
      otpRequestCount: {
        type: Number,
        default: 0,
      },
      otpRequestTimestamp: {
        type: Date,
        default: Date.now,
      },
    },

    phoneNumber: {
      code: {
        // Country code for phone number
        type: String,
        default: "",
      },
      number: {
        // Phone number without country code
        type: String,
        default: "",
      },
      default: {},
    },
    verificationStatus: {
      email: {
        type: String,
        enum: ["pending", "verified"],
        default: "pending",
      },
      phoneNumber: {
        type: String,
        enum: ["pending", "verified"],
        default: "pending",
      },
    },

    password: {
      type: String,
      default: "",
    },
    accountState: {
      userType: {
        type: String,
        enum: USER_TYPES,
        default: "user",
      },
      status: {
        type: String,
        enum: ["pending", "inactive", "active", "cancelled", "expired", "suspended", "restricted", "deleted"],
        default: "pending",
      },
      reason: {
        type: String,
        default: "",
      },
    },

    otpInfo: {
      emailOtp: {
        otp: {
          type: String,
          default: "",
        },
        otpUsed: {
          type: Boolean,
          default: false,
        },
        otpExpires: {
          type: Date,
        },
        otpRequestCount: {
          type: Number,
          default: 0,
        },
        otpRequestTimestamp: {
          type: Date,
          default: Date.now,
        },
      },
      phoneNumberOtp: {
        otp: {
          type: String,
          default: "",
        },
        otpUsed: {
          type: Boolean,
          default: false,
        },
        otpExpires: {
          type: Date,
        },
        otpRequestCount: {
          type: Number,
          default: 0,
        },
        otpRequestTimestamp: {
          type: Date,
          default: Date.now,
        },
      },
    },

    resetToken: {
      //used to reset password
      type: String,
      default: "",
    },
    timezone: {
      type: String,
      default: "",
      required: true,
    },
    language: {
      type: String,
      default: "en",
    },

    blockedUsers: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },
    reportCount: {
      type: Number,
      default: 0,
    },
    reportedBy: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },

    provider: {
      // Social provider details
      type: String,
      enum: ["google", "facebook", "apple", "email"], // Provider types
      default: "email",
    },
    googleId: {
      type: String,
      default: null,
    },
    facebookId: {
      type: String,
      default: null,
    },
    appleId: {
      type: String,
      default: null,
    },
    twoFA: {
      secret: {
        type: String,
        default: null,
      },
      isEnabled: {
        type: Boolean,
        default: false,
      },
      isConfirmed: {
        type: Boolean,
        default: false,
      },
      enabledAt: {
        type: Date,
        default: null,
      },
    },

    // --- TradeDrop consumer fields (extend existing users collection) ---
    handle: {
      type: String,
      default: undefined,
      sparse: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    bio: {
      type: String,
      default: "",
    },
    specialty: {
      type: String,
      default: "",
      trim: true,
    },
    areaLabel: {
      type: String,
      default: "",
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    location: {
      type: [Number],
      default: undefined,
    },
    openToTrade: {
      type: Boolean,
      default: true,
    },
    radarVisible: {
      type: Boolean,
      default: true,
    },
    hideFromSearch: {
      type: Boolean,
      default: false,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    onboarding: {
      type: Boolean,
      default: false,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    stats: {
      disputesLost: { type: Number, default: 0 },
    },
    // Bumped inside transactions to serialize active-trade limit checks per user
    tradeLock: { type: Number, default: 0 },
    deletedAt: {
      type: Date,
      default: null,
    },
    crafts: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
      default: [],
    },
    interests: { type: [String], default: [] },
    links: {
      type: [
        {
          kind: { type: String },
          url: { type: String, default: "" },
        },
      ],
      default: [],
    },
    portfolioItems: {
      type: [
        {
          _id: { type: String },
          imageUrls: {
            type: [String],
            default: undefined,
            validate: {
              validator: (urls) =>
                !urls ||
                (urls.length >= 1 &&
                  urls.length <= MAX_PORTFOLIO_IMAGES &&
                  urls.every((url) => typeof url === "string" && url.trim())),
              message: "Portfolio items must have between 1 and 6 Image URLs",
            },
          },
          title: { type: String, default: "" },
          sortOrder: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    /** TradeDrop OTP slots (signup / password_reset) — separate from legacy otpInfo */
    tfOtp: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ "accountState.status": 1, deletedAt: 1 });

// Hash password before saving to database
userSchema.pre("save", async function (next) {
  const user = this;

  // password hashing (existing) — skip if already bcrypt (TradeDrop hashes in service)
  if (user.isModified("password")) {
    if (!/^\$2[aby]?\$/.test(String(user.password || ""))) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(user.password, salt);
    }
  }

  // normalize email (existing)
  if (user.isModified("email")) {
    user.email = user.email.toLowerCase().trim();
  }

  if (this.lat != null && this.lng != null) {
    this.location = [this.lng, this.lat];
  }
  next();
});

// Generate JWT token
userSchema.methods.generateAuthToken = function () {
  const user = this;
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
    // expiresIn: "1h", // Token valid for 1 hour
  });
  return token;
};

// Find user by credentials
userSchema.statics.findByCredentials = async (email, password, userType, timezone, populateFields = []) => {
  let query = User.findOne({ email: email.toLowerCase().trim() });

  // Populate specified fields
  populateFields.forEach((field) => {
    query = query.populate(field);
  });

  const user = await query;

  if (!user) {
    return { error: "user_not_found" }; // Return an error key if user not found
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return { error: "incorrect_password" }; // Return an error key if password doesn't match
  }

  if (timezone && user.timezone !== timezone) {
    user.timezone = timezone; // Update user's timezone if provided
    await user.save();
  }

  return user; // Return the user object if login is successful
};

userSchema.methods.generateOtp = function (type = "email", timezone = "UTC") {
  const user = this;
  const now = Date.now();
  const allowedOtpRequests = 3;

  let otpRequestCount, otpRequestTimestamp;

  // Handle request count and timestamp based on the type
  if (type === "email") {
    otpRequestCount = user.otpInfo.emailOtp.otpRequestCount;
    otpRequestTimestamp = user.otpInfo.emailOtp.otpRequestTimestamp;
  } else if (type === "phoneNumber") {
    otpRequestCount = user.otpInfo.phoneNumberOtp.otpRequestCount;
    otpRequestTimestamp = user.otpInfo.phoneNumberOtp.otpRequestTimestamp;
  }

  // Check if the request count exceeds the allowed limit
  const timeLimit = moment(otpRequestTimestamp).add(1, "hour").valueOf();
  if (now > timeLimit) {
    // Reset OTP request count and timestamp after 1 hour
    if (type === "email") {
      user.otpInfo.emailOtp.otpRequestCount = 0;
      user.otpInfo.emailOtp.otpRequestTimestamp = now;
    } else if (type === "phoneNumber") {
      user.otpInfo.phoneNumberOtp.otpRequestCount = 0;
      user.otpInfo.phoneNumberOtp.otpRequestTimestamp = now;
    }
  } else if (otpRequestCount >= allowedOtpRequests) {
    if (process.env.NODE_ENV == "prod") {
      return { error: "too_many_otp_requests" }; // Return an error key if too many OTP requests
    }
  }

  // Increment the OTP request count
  if (type === "email") {
    user.otpInfo.emailOtp.otpRequestCount += 1;
  } else if (type === "phoneNumber") {
    user.otpInfo.phoneNumberOtp.otpRequestCount += 1;
  }

  // Generate the OTP using randomBytes for security
  const otp = (parseInt(randomBytes(3).toString("hex"), 16) % 1000000).toString().padStart(6, "0");

  // Set OTP expiry: 10 minutes for email, 5 minutes for phone
  const otpExpires = moment
    .tz(now, timezone)
    .add(type === "email" ? 10 : 5, "minutes")
    .valueOf();

  // Update OTP details based on the type
  if (type === "email") {
    user.otpInfo.emailOtp.otp = otp;
    user.otpInfo.emailOtp.otpExpires = otpExpires;
    user.otpInfo.emailOtp.otpUsed = false;
  } else if (type === "phoneNumber") {
    user.otpInfo.phoneNumberOtp.otp = otp;
    user.otpInfo.phoneNumberOtp.otpExpires = otpExpires;
    user.otpInfo.phoneNumberOtp.otpUsed = false;
  }

  return otp; // Return the OTP for sending it to the user
};

userSchema.methods.generateEmailVerificationToken = function (timezone = "UTC") {
  const user = this;
  const now = Date.now();

  // Limit requests
  const allowedRequestsPerHour = 10;
  const lastTimestamp = user.otpInfo?.emailOtp?.otpRequestTimestamp || 0;
  const count = user.otpInfo?.emailOtp?.otpRequestCount || 0;
  if (process.env.NODE_ENV !== "dev") {
    if (now < moment(lastTimestamp).add(1, "hour").valueOf() && count >= allowedRequestsPerHour) {
      return { error: "too_many_verification_requests" };
    }
  }

  // Update OTP info for limiting
  user.otpInfo.emailOtp.otpRequestTimestamp = now;
  user.otpInfo.emailOtp.otpRequestCount = count + 1;

  const { rawToken, hashedToken } = generateSecureToken();

  // 3. Set expiry (e.g. 10 minutes)
  const expiresAt = moment.tz(now, timezone).add(10, "minutes").valueOf();

  user.emailVerification = {
    tokenHash: hashedToken,
    expiresAt,
    used: false,
  };
  const verificationLink = createVerificationLink(rawToken);
  return {
    verificationLink,
    rawToken,
  }; // Return raw token to send in the email
};

userSchema.methods.generatePasswordResetToken = function (timezone = "UTC") {
  const user = this;
  const now = Date.now();

  // Ensure parent object exists
  if (!user.passwordReset) {
    user.passwordReset = {};
  }
  // request count limit
  const allowedRequestsPerHour = 3;
  const lastTimestamp = user.passwordReset?.otpRequestTimestamp || 0;
  const count = user.passwordReset?.otpRequestCount || 0;
  if (process.env.NODE_ENV !== "dev") {
    // Check if the last request was within the last hour and if the count exceeds the limit
    if (now < moment(lastTimestamp).add(1, "hour").valueOf() && count >= allowedRequestsPerHour) {
      return { error: "too_many_password_reset_requests" };
    }
  }

  const { rawToken, hashedToken } = generateSecureToken();

  const expiresAt = moment.tz(now, timezone).add(15, "minutes").valueOf();

  // Update OTP info for limiting
  user.passwordReset.otpRequestTimestamp = now;
  user.passwordReset.otpRequestCount = count + 1;
  user.passwordReset.tokenHash = hashedToken;
  user.passwordReset.expiresAt = expiresAt;
  user.passwordReset.used = false;

  const resetLink = createResetPasswordLink(rawToken);

  return {
    resetLink,
    rawToken,
  };
};

// Exclude sensitive fields when returning user object
userSchema.methods.toJSON = function (userData) {
  let userObject;

  if (userData) {
    // Case 1: explicitly provided plain object
    userObject = { ...userData };
  } else if (typeof this.toObject === "function") {
    // Case 2: called on a mongoose doc
    userObject = this.toObject();
  } else {
    // Case 3: fallback if it's already a plain object
    userObject = { ...this };
  }

  const baseUrl = `${process.env.S3_BASE_URL}`;

  // Attach base URL to profileIcon
  if (userObject.profileIcon && !userObject.profileIcon.startsWith("http")) {
    userObject.profileIcon = baseUrl + userObject.profileIcon;
  } else if (!userObject.profileIcon) {
    userObject.profileIcon = baseUrl + "noimage.png";
  }

  //attach baseUrl with company logo and cover image
  if (
    userObject.companyDetails &&
    userObject.companyDetails.logo &&
    !userObject.companyDetails.logo.startsWith("http")
  ) {
    userObject.companyDetails.logo = baseUrl + userObject.companyDetails.logo;
  }

  if (
    userObject.companyDetails &&
    userObject.companyDetails.coverImage &&
    !userObject.companyDetails.coverImage.startsWith("http")
  ) {
    userObject.companyDetails.coverImage = baseUrl + userObject.companyDetails.coverImage;
  }

  delete userObject.password;

  if (process.env.NODE_ENV === "prod") {
    delete userObject.otpInfo;
    delete userObject.emailVerification;
  }

  return userObject;
};

userSchema.methods.addBaseUrlToProfileIcon = function (user) {
  const baseUrl = `${process.env.S3_BASE_URL}`;
  if (user.profileIcon && !user.profileIcon.startsWith("http")) {
    user.profileIcon = baseUrl + user.profileIcon;
  }
  return { ...user, profileIcon: user.profileIcon };
};
userSchema.index(
  {
    email: 1,
    "accountState.userType": 1,
  },
  {
    name: "email_userType_login_idx",
  },
);

userSchema.index({ location: "2dsphere" });
userSchema.index({ createdAt: 1, "accountState.status": 1 });

const User = mongoose.model("User", userSchema);

module.exports = {
  User,
  generateResetToken,
  createVerificationLink,
  USER_TYPES,
};
