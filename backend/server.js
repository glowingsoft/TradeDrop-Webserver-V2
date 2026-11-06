/**
 * ------------------------------------------------
 * Unified Logging (FIRST – before anything else)
 * ------------------------------------------------
 */
require("./config/logging");
const { logger, crashLogger, accessLogger } = require("./config/logging");

// expose globally (safe + intentional)
global.logger = logger;

/**
 * ------------------------------------------------
 * Env
 * ------------------------------------------------
 */
require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});

require("express-async-errors");
const express = require("express");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const moduleAlias = require("module-alias");

/**
 * ------------------------------------------------
 * Module aliases
 * ------------------------------------------------
 */
const aliases = require("../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", target));
}
require("module-alias/register");

/**
 * ------------------------------------------------
 * App & Infra Imports
 * ------------------------------------------------
 */
const { i18nConfig } = require("./config/i18nConfig");
const { securityMiddleware } = require("./middlewares/security");
const { initTextModeration } = require("./services/moderation/textModeration");
const { textModerationMiddleware } = require("./services/moderation/textModeration");
const createRateLimiter = require("./helperUtils/rateLimiter");

const { sendResponse } = require("./helperUtils/responseUtil");

const connectToDB = require("./helperUtils/server-setup");
const { backupMongoDB } = require("./helperUtils/dataBaseBackup");
const { getRedisClient } = require("./config/redis/redisConfig");
const { startCrons } = require("./config/cron");

/**
 * ------------------------------------------------
 * Socket Server
 * ------------------------------------------------
 */
const { createSocketServer } = require("./config/sockets/socketServer");

const { allowedOrigins } = require("./config/origins");

/**
 * =======================================================
 * Express App
 * =======================================================
 */

const app = express();
app.set("trust proxy", 1);

/**
 * ------------------------------------------------
 * Health & Root
 * ------------------------------------------------
 */
app.get("/api", (req, res) => {
  res.json({
    name: "TradeDrop API",
    version: "v1",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
  });
});

const swaggerUi = require("swagger-ui-express");
const tradedropOpenApi = require("./docs/tradedropOpenApi");
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(tradedropOpenApi));
app.get("/api/openapi.json", (req, res) => {
  res.status(200).json(tradedropOpenApi);
});
/**
 * =======================================================
 * Security
 * =======================================================
 */
securityMiddleware(app, {
  allowedOrigins,
  adminIPWhitelist: [],
  maxRequestSize: "10mb",
});

/**
 * =======================================================
 * Middlewares
 * =======================================================
 */
app.use(i18nConfig.init);

// ✅ unified access logs
app.use(accessLogger);

// keep existing middleware (unchanged)
if (process.env.NODE_ENV !== "prod") {
  app.use(morgan("dev"));
}

app.use(express.json());
app.use(textModerationMiddleware);
const globalLimiter = createRateLimiter("api-v1-global", 15, 200, {
  keyGenerator: (req) => `ip:${req.ip}`,
});

app.use("/api/v1", globalLimiter);

/**
 * ------------------------------------------------
 * Routes
 * ------------------------------------------------
 */
app.use("/api/v1/admin", require("./roles/admin/routes"));
app.use("/api/v1", require("./routes"));

// Fallback
app.use((req, res) => {
  sendResponse({
    res,
    statusCode: 404,
    translationKey: "route_not_found",
  });
});

/**
 * =======================================================
 * Global Express Error Handler
 * =======================================================
 */
app.use((err, req, res, next) => {
  logger.error("Request error", {
    method: req.method,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    message: "Internal server error",
  });
});

/**
 * =======================================================
 * Socket + HTTP Server
 * =======================================================
 */
const server = createSocketServer(app, allowedOrigins);

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  logger.info("HTTP server listening", {
    port: PORT,
    env: process.env.NODE_ENV,
  });
});

/**
 * =======================================================
 * Start Server AFTER DB Connection
 * =======================================================
 */

(async () => {
  try {
    await connectToDB();
    await initTextModeration();
    getRedisClient();
    startCrons();
    setInterval(backupMongoDB, 24 * 60 * 60 * 1000);
  } catch (err) {
    logger.fatal("Startup failure", {
      error: err.message,
      stack: err.stack,
    });
  }
})();

/**
 * =======================================================
 * Graceful shutdown (expected)
 * =======================================================
 */
const shutdown = async (signal) => {
  logger.warn("Shutdown signal received", { signal });

  try {
    if (global.io) {
      await global.io.close();
      logger.info("Socket.IO closed");
    }
    process.exit(0);
  } catch (err) {
    logger.error("Error during graceful shutdown", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/**
 * =======================================================
 * Crash handlers (unexpected)
 * =======================================================
 */
process.on("unhandledRejection", (reason, promise) => {
  crashLogger.fatal("Unhandled Promise Rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });

  // Give logger time to flush
  setTimeout(() => {
    process.exit(1);
  }, 100);
});

process.on("uncaughtException", (err) => {
  crashLogger.fatal("Uncaught Exception", {
    error: err.message,
    stack: err.stack,
  });

  setTimeout(() => {
    process.exit(1);
  }, 100);
});
