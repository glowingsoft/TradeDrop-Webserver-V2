function normalizeInterests(interests, errorKey) {
  if (!Array.isArray(interests) || interests.some((interest) => typeof interest !== "string" || !interest.trim())) {
    const error = new Error(errorKey);
    error.translationKey = errorKey;
    error.statusCode = 400;
    throw error;
  }
  return interests.map((interest) => interest.trim());
}

module.exports = { normalizeInterests };
