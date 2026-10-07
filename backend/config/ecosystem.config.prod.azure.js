module.exports = {
  apps: [
    {
      name: "tradedrop-backend",

      script: "backend/server.js",

      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,

      max_memory_restart: "1024M",

      listen_timeout: 10000,
      kill_timeout: 5000,

      node_args: "--max-old-space-size=1024",

      output: "/dev/stdout",
      error: "/dev/stderr",

      env: {
        NODE_ENV: "prod",
      },
    },
  ],
};