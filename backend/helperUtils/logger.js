/**
 * ============================================================
 * Logger Utility (Production-Safe, Dev-Friendly)
 * ============================================================
 *
 * PURPOSE
 * --------
 * Lightweight logger designed for:
 * - PM2 cluster environments
 * - Azure / cloud stdout logging
 * - Millions of requests
 *
 * Goals:
 * - Zero configuration
 * - Minimal noise in production
 * - Fast debugging in development
 *
 * ------------------------------------------------------------
 * HOW IT WORKS
 * ------------------------------------------------------------
 *
 * - Logs are written as structured JSON (one line per event)
 * - In PRODUCTION (NODE_ENV=prod):
 *     - DEBUG logs are SILENT
 *     - INFO / WARN / ERROR / FATAL are printed
 * - In NON-PROD (dev, localhost, staging):
 *     - ALL logs are printed
 *
 * PM2 captures stdout/stderr and handles:
 * - log files
 * - rotation
 * - process restarts
 *
 * ------------------------------------------------------------
 * QUICK USAGE EXAMPLES
 * ------------------------------------------------------------
 *
 * // DEV-ONLY debugging (safe to spam)
 * logger.log("Scanning files...");
 * logger.log("Payload received", { size: payload.length });
 *
 * // Application lifecycle
 * logger.info("Server started", { port: 4014 });
 * logger.info("Redis connected", { target: "local" });
 *
 * // Something unexpected but recoverable
 * logger.warn("Cache miss", { key: "user:123" });
 *
 * // Request or system failure
 * logger.error("Database query failed", {
 *   collection: "users",
 *   error: err.message,
 * });
 *
 * // Fatal error (process will EXIT, PM2 will restart worker)
 * logger.fatal("Uncaught exception", {
 *   error: err.message,
 *   stack: err.stack,
 * });
 *
 * ------------------------------------------------------------
 * WHEN TO USE WHICH LEVEL
 * ------------------------------------------------------------
 *
 * logger.log   → Temporary dev/debug prints (silent in prod)
 * logger.info  → Startup, shutdown, connections, lifecycle
 * logger.warn  → Unexpected but recoverable situations
 * logger.error → Request failures, external service errors
 * logger.fatal → Process-ending conditions (crash boundary)
 *
 * ------------------------------------------------------------
 * WHAT NOT TO LOG
 * ------------------------------------------------------------
 *
 * ❌ Passwords / secrets / tokens
 * ❌ Full request bodies
 * ❌ Large payloads
 * ❌ High-frequency loops
 *
 * ------------------------------------------------------------
 * NOTES
 * ------------------------------------------------------------
 *
 * - workerId comes from PM2 (NODE_APP_INSTANCE)
 * - pid helps correlate crashes
 * - JSON logs are easy to ship to Azure Monitor later
 *
 * ============================================================
 */

const isProd = process.env.NODE_ENV === "prod";

function write(level, message, meta = {}) {
  const log = {
    level,
    time: new Date().toISOString(),
    pid: process.pid,
    workerId: process.env.NODE_APP_INSTANCE,
    message,
    ...meta,
  };

  const output = JSON.stringify(log);

  if (level === "ERROR" || level === "FATAL") {
    console.error(output);
  } else if (!isProd) {
    console.log(output);
  }
}

const logger = {
  /**
   * DEV-ONLY quick debugging
   * Safe to spam, silent in prod
   */
  log: (message, meta) => {
    if (!isProd) {
      write("DEBUG", message, meta);
    }
  },

  /**
   * Informational (boot, connections, lifecycle)
   */
  info: (message, meta) => {
    write("INFO", message, meta);
  },

  /**
   * Something odd but recoverable
   */
  warn: (message, meta) => {
    write("WARN", message, meta);
  },

  /**
   * Request-level or system errors
   */
  error: (message, meta) => {
    write("ERROR", message, meta);
  },

  /**
   * Process is about to die
   * PM2 will restart the worker
   */
  fatal: (message, meta) => {
    write("FATAL", message, meta);
    process.exit(1);
  },
};

module.exports = logger;
