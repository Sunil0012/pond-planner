/**
 * PM2 Ecosystem config — 4 Node.js backends + 1 Go load balancer
 *
 * Usage on server:
 *   cd /home/student/pond-planner-pro
 *   npm ci && npm run build
 *   bash deploy/deploy.sh
 *
 * Manual:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Live URL: http://10.1.75.51:3205
 */

module.exports = {
  apps: [
    // ── Go load balancer on port 3205 (public entry point) ───────────────
    {
      name: "pondlb",
      script: "./deploy/lb/pondlb",
      args: "-port 3000 -dist ./dist",
      cwd: "/home/student/pond-planner-pro",
      watch: false,
      autorestart: true,
      max_memory_restart: "128M",
      restart_delay: 2000,
      env: { PORT: "3000" },
    },

    // ── Node.js backend instances (tsx runs TS directly — always latest) ──
    {
      name: "pondsite-1",
      script: "npx",
      args: "tsx backend/server.ts",
      cwd: "/home/student/pond-planner-pro",
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      env: { NODE_ENV: "production", PORT: "3001" },
    },
    {
      name: "pondsite-2",
      script: "npx",
      args: "tsx backend/server.ts",
      cwd: "/home/student/pond-planner-pro",
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      env: { NODE_ENV: "production", PORT: "3002" },
    },
    {
      name: "pondsite-3",
      script: "npx",
      args: "tsx backend/server.ts",
      cwd: "/home/student/pond-planner-pro",
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      env: { NODE_ENV: "production", PORT: "3003" },
    },
    {
      name: "pondsite-4",
      script: "npx",
      args: "tsx backend/server.ts",
      cwd: "/home/student/pond-planner-pro",
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      env: { NODE_ENV: "production", PORT: "3004" },
    },
  ],
};
