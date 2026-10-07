const {
  sendResponse,
  parsePaginationParams,
  generateMeta,
} = require("@helperUtils/responseUtil");
const { User } = require("../../../../models/UserModel");
const AdminSettings = require("../models/AdminSettings");
const Faq = require("../models/Faq");
const { cache, invalidate } = require("@redisCache");
const ACTIVE_ADMIN_SETTINGS_CACHE_KEY = "adminSettings:active";

const buildAdminSettingsCacheKey = ({ scope = "public" }) => {
  return `${ACTIVE_ADMIN_SETTINGS_CACHE_KEY}:${scope}`;
};

const invalidateAdminSettingsScope = async (scope) => {
  await invalidate(buildAdminSettingsCacheKey({ scope }));
};

const ADMIN_SETTING_SCOPES = {
  TERMS: "terms_conditions",
  REVIEW_TERMS: "review_terms_conditions",
  CUSTOMER_TERMS: "customer_terms_conditions",
  ABOUT_US: "about_us",
  PRIVACY_POLICY: "privacy_policy",
  FAQS: "faqs",
};

// Get Terms and Conditions
const getTermsAndConditions = async (req, res) => {
  try {
    const cacheKey = buildAdminSettingsCacheKey({
      scope: ADMIN_SETTING_SCOPES.TERMS,
    });

    const settings = await cache({
      namespace: cacheKey,
      ttl: 86400, // 1 day

      fetchFn: async () => {
        return AdminSettings.findOne({}, "terms_and_conditions");
      },
    });

    if (!settings) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "terms_and",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "terms_and_1",
      data: settings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};
const getReviewTermsAndConditions = async (req, res) => {
  try {
    const cacheKey = buildAdminSettingsCacheKey({
      scope: ADMIN_SETTING_SCOPES.REVIEW_TERMS,
    });

    const settings = await cache({
      namespace: cacheKey,
      ttl: 86400, // 1 day

      fetchFn: async () => {
        return AdminSettings.findOne({}, "review_terms_and_conditions");
      },
    });

    if (!settings) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "review_terms_and_conditions",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "review_terms_and_conditions_1",
      data: settings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

// Get About Us
const getAboutUs = async (req, res) => {
  try {
    const cacheKey = buildAdminSettingsCacheKey({
      scope: ADMIN_SETTING_SCOPES.ABOUT_US,
    });

    const settings = await cache({
      namespace: cacheKey,
      ttl: 86400, // 1 day

      fetchFn: async () => {
        return AdminSettings.findOne({}, "about_us");
      },
    });

    if (!settings) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "about_us",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "about_us_1",
      data: settings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

// Get Privacy Policy
const getPrivacyPolicy = async (req, res) => {
  try {
    const cacheKey = buildAdminSettingsCacheKey({
      scope: ADMIN_SETTING_SCOPES.PRIVACY_POLICY,
    });

    const settings = await cache({
      namespace: cacheKey,
      ttl: 86400, // 1 day

      fetchFn: async () => {
        return AdminSettings.findOne({}, "privacy_policy");
      },
    });

    if (!settings) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "privacy_policy",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "privacy_policy_1",
      data: settings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

// Get Privacy Policy
const getFaqs = async (req, res) => {
  try {
    const { page, limit } = parsePaginationParams(req);
    const { keyword } = req.query;

    const skip = (page - 1) * limit;
    const type = req.user.userType;

    const cacheKey = buildAdminSettingsCacheKey({
      scope: ADMIN_SETTING_SCOPES.FAQS,
      skip,
      limit,
      type: req.user.userType,
    });

    const result = await cache({
      namespace: cacheKey,
      ttl: 86400, // 1 day

      fetchFn: async () => {
        let queryConditions = {};
        if (type) {
          queryConditions.type = type;
        }

        if (keyword && keyword.trim() !== "") {
          queryConditions.$or = [
            { question: { $regex: keyword, $options: "i" } },
            { answer: { $regex: keyword, $options: "i" } },
          ];
        }

        const [faqs, totalRecords] = await Promise.all([
          Faq.find(queryConditions)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
          Faq.countDocuments(queryConditions),
        ]);

        return {
          faqs,
          totalRecords,
        };
      },
    });

    const meta = generateMeta(page, limit, result.totalRecords);

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "faqs_fetched_successfully",
      data: result.faqs,
      meta,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "something_went_wrong",
      error,
    });
  }
};

// Create Admin Settings
const createAdminSettings = async (req, res) => {
  try {
    // invalidate only relevant sections
    await Promise.all([
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.TERMS),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.ABOUT_US),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.PRIVACY_POLICY),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.REVIEW_TERMS),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.CUSTOMER_TERMS),
    ]);

    const {
      terms_and_conditions,
      about_us,
      privacy_policy,
      review_terms_and_conditions,
    } = req.body;

    const existingSettings = await AdminSettings.findOne();
    if (existingSettings) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "admin_settings",
      });
    }

    const newSettings = new AdminSettings({
      terms_and_conditions: terms_and_conditions || "",
      about_us: about_us || "",
      privacy_policy: privacy_policy || "",
      review_terms_and_conditions: review_terms_and_conditions || "",
    });

    const savedSettings = await newSettings.save();

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "admin_settings_1",
      data: savedSettings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

// Update Admin Settings (Optional: To update multiple fields at once)
const updateAdminSettings = async (req, res) => {
  const { id } = req.params;
  const updateData = {};

  const invalidations = [];

  if (req.body.terms_and_conditions) {
    updateData.terms_and_conditions = req.body.terms_and_conditions;
    invalidations.push("terms_and_conditions");
  }
  if (req.body.review_terms_and_conditions) {
    updateData.review_terms_and_conditions =
      req.body.review_terms_and_conditions;
    invalidations.push("review_terms_and_conditions");
  }

  if (req.body.customer_terms_and_conditions) {
    updateData.customer_terms_and_conditions =
      req.body.customer_terms_and_conditions;
    invalidations.push("customer_terms_and_conditions");
  }

  if (req.body.about_us) {
    updateData.about_us = req.body.about_us;
    invalidations.push("about_us");
  }

  if (req.body.privacy_policy) {
    updateData.privacy_policy = req.body.privacy_policy;
    invalidations.push("privacy_policy");
  }

  // invalidate only touched scopes
    await Promise.all([
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.TERMS),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.ABOUT_US),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.PRIVACY_POLICY),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.REVIEW_TERMS),
      invalidateAdminSettingsScope(ADMIN_SETTING_SCOPES.CUSTOMER_TERMS),
    ]);

  try {
    const settings = await AdminSettings.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    if (!settings) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "admin_settings_2",
      });
    }

    if (req.body.terms_and_conditions) {
      await User.updateMany(
        { "accountState.userType": "organizer" },
        { $set: { termsAccepted: req.body.termsAccepted || false } },
      );
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "admin_settings_3",
      data: settings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

const getCustomerTermsAndConditions = async (req, res) => {
  try {
    const cacheKey = buildAdminSettingsCacheKey({
      scope: "customer_terms_conditions",
      skip: 0,
      limit: 10,
    });

    const settings = await cache({
      namespace: cacheKey,
      ttl: 86400, // 1 day

      fetchFn: async () => {
        return AdminSettings.findOne({}, "customer_terms_and_conditions");
      },
    });

    if (!settings) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "terms_and",
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "terms_and_1",
      data: settings,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: error.message,
      error,
    });
  }
};

module.exports = {
  getTermsAndConditions,
  getAboutUs,
  getPrivacyPolicy,
  updateAdminSettings,
  createAdminSettings,
  getFaqs,
  getCustomerTermsAndConditions,
  getReviewTermsAndConditions,
};
