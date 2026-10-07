const Language = require("../models/Language");
const { User } = require("../models/UserModel");
const {
  sendResponse,
  parsePaginationParams,
  generateMeta,
  validateParams,
} = require("../helperUtils/responseUtil");
const { userCache } = require("../config/nodeCache");

// Create a new language
const createLanguage = async (req, res) => {
  const { title, transliteration, flag, code, status = "active" } = req.body;

  try {
    //validate params
    const validationOptions = {
      rawData: ["title", "transliteration", "code"],
    };

    if (!validateParams(req, res, validationOptions)) {
      return;
    }

    const language = new Language({ title, transliteration, flag, code, status });
    await language.save();

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "language_created_successfully", // Translation key for success
      data: language,
    });
  } catch (error) {
    if (error.code === 11000) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "language_code_unique_violation", // Custom translation key for duplicate language code
        error,
      });
    }
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server",
      error,
    });
  }
};

// Get all languages with pagination
const getLanguages = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);

  let mLimit = req.query.limit || 0;

  const { keyword, status, date } = req.query;

  try {
    let queryConditions = {};
    if (status) {
      queryConditions.status = status;
    } else {
      queryConditions.status = { $ne: "deleted" };
    }
    // If a keyword is provided, apply a search filter on multiple fields
    if (keyword) {
      queryConditions.$or = [
        { title: { $regex: keyword, $options: "i" } },
        { transliteration: { $regex: keyword, $options: "i" } },
        { code: { $regex: keyword, $options: "i" } },
      ];
    }

    const [
      languages,
      totalLanguages,
      total,
      active,
      inactive,
    ] = await Promise.all([
      Language.find(queryConditions)
        .sort({ title: 1 }) // Sort by title in alphabetical order
        .skip(mLimit === 0 ? 0 : (page - 1) * limit)
        .limit(mLimit === 0 ? 0 : limit),
      Language.countDocuments(queryConditions), // Count filtered languages
      Language.countDocuments({ status: { $ne: "deleted" } }), // Count all languages
      Language.countDocuments({ status: "active" }), // Count active languages
      Language.countDocuments({ status: "inactive" }), // Count inactive languages
    ]);

    let meta = generateMeta(page, limit, totalLanguages);
    meta.tagsCount = {
      total,
      active,
      inactive,
    };

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "languages_fetched_successfully", // Translation key for success
      data: languages,
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
};

// Update an existing language
const updateLanguage = async (req, res) => {
  const { id } = req.params;
  const { title, transliteration, flag, code, status } = req.body;
  try {

    const validationOptions = {
      pathParams: ["id"],
      objectIdFields: ["id"],
    };

    if (!validateParams(req, res, validationOptions)) {
      return;
    }
    const language = await Language.findById(id);
    if (!language) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "language_not_found",
      });
    }

    language.title = title || language.title;
    language.transliteration = transliteration || language.transliteration;
    language.flag = flag || language.flag;
    language.code = code || language.code;
    if (status !== undefined) {
      language.status = status;
    }

    await language.save();

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "language_updated_successfully",
      data: language,
    });
  } catch (error) {
    // Handle validation errors from Mongoose
    const statusCode = error.name === "ValidationError" ? 400 : 500;
    const translationKey =
      error.name === "ValidationError"
        ? Object.values(error.errors)[0].message
        : error.message;

    return sendResponse({
      res,
      statusCode,
      translationKey,
      error,
    });
  }
};

// Delete a language by ID
const deleteLanguage = async (req, res) => {
  const { id } = req.params;

  try {

    const validationOptions = {
      pathParams: ["id"],
      objectIdFields: ["id"],
    };

    if (!validateParams(req, res, validationOptions)) {
      return;
    }
    const language = await Language.findById(id);
    if (!language) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "language_not_found",
      });
    }

    await language.deleteOne();

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "language_deleted_successfully",
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

// Update a user's preferred language
const updateUserLanguage = async (req, res) => {
  const { _id: userId } = req.user;
  const { languageId } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "user_not_found",
      });
    }

    const language = await Language.findById(languageId);
    if (!language) {
      return sendResponse({
        res,
        statusCode: 404,
        translationKey: "language_not_found",
      });
    }

    user.language = language.code;
    await user.save();
    userCache.del(userId.toString())
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_language_updated_successfully",
      data: { userId, code: language.code },
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

module.exports = {
  createLanguage,
  getLanguages,
  updateLanguage,
  deleteLanguage,
  updateUserLanguage,
};
