/**
 * Mongo connection helper for TradeDrop integration tests.
 * Requires MONGO_URI_TEST — never uses production BASE_URL alone without explicit test URI.
 */
const mongoose = require("mongoose");
const path = require("path");

function requireMongoUriTest() {
  const uri = process.env.MONGO_URI_TEST;
  if (!uri || !String(uri).trim()) {
    throw new Error(
      "MONGO_URI_TEST is required for TradeDrop Mongo integration tests. " +
        "Set it to a dedicated test database, e.g. " +
        "MONGO_URI_TEST=mongodb://127.0.0.1:27017/tradedrop-test " +
        "(never point this at production).",
    );
  }
  const lower = String(uri).toLowerCase();
  if (lower.includes("prod") && !lower.includes("tradedrop-test")) {
    throw new Error(
      "Refusing to run Mongo tests against a URI that looks like production. Use MONGO_URI_TEST=.../tradedrop-test",
    );
  }
  return uri;
}

async function connectTestMongo() {
  const uri = requireMongoUriTest();
  if (mongoose.connection.readyState === 1) {
    // Already connected — ensure it's the test DB
    return mongoose.connection;
  }
  await mongoose.connect(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
  });
  return mongoose.connection;
}

async function clearTradeDropCollections() {
  const names = [
    "users",
    "categories",
    "cmspages",
    "areas",
    "appsettings",
    "drops",
    "tapins",
    "trades",
    "reviews",
    "connections",
    "messagerequests",
    "blockedusers",
    "disputes",
    "auditlogs",
    "conversations",
    "messages",
  ];
  for (const name of names) {
    try {
      await mongoose.connection.collection(name).deleteMany({});
    } catch (_) {
      // collection may not exist yet
    }
  }
}

async function disconnectTestMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  requireMongoUriTest,
  connectTestMongo,
  clearTradeDropCollections,
  disconnectTestMongo,
};
