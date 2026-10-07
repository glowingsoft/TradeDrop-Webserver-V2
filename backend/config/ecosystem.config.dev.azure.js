module.exports = {
  apps: [
    {
      name: "tradedrop-backend",

      script: "backend/server.js",

      /**
       * Azure App Service requires fork mode
       * Cluster mode causes port conflicts
       */
      exec_mode: "fork",
      instances: 1,

      /**
       * Restart protection
       */
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,

      /**
       * Startup / shutdown safety
       */
      listen_timeout: 10000,
      kill_timeout: 5000,

      /**
       * Memory protection
       */
      max_memory_restart: "1024M",

      /**
       * Increase Node heap size
       */
      node_args: "--max-old-space-size=1024",

      /**
       * Logging
       * Azure collects stdout/stderr automatically
       */
      output: "/dev/stdout",
      error: "/dev/stderr",
      merge_logs: true,
      time: true,

      /**
       * Environment variables
       */
      env: {
        NODE_ENV: "dev",
      },
    },
  ],
};