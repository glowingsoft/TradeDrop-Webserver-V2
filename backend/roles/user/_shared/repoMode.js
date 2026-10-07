/**
 * AUTH_REPOSITORY=memory (default for unit/mock tests)
 * AUTH_REPOSITORY=mongo  → Mongoose repos on BASE_URL / MONGO_URI_TEST
 */
function useMongoRepository() {
  return String(process.env.AUTH_REPOSITORY || "mongo").toLowerCase() === "mongo";
}

module.exports = { useMongoRepository };
