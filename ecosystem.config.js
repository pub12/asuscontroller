/**
 * PM2 process definitions for NetWarden.
 *
 * Two long-running processes, both REQUIRED in production:
 *   - netwarden-web    : the Next.js app (served on PORT, default 3051 here)
 *   - netwarden-worker : the standalone sync/timer worker (fires scheduled
 *                        block/unblock jobs, device sync, telemetry ingest).
 *                        The web app does NOT do this work — the worker must run.
 *
 * IMPORTANT — single instance only. The codebase assumes ONE web process and
 * ONE worker serialize their SQLite + router-state writes. Do not switch to
 * cluster mode or raise `instances`.
 *
 * Secrets/config come from `.env.local` (loaded by Next for the web app and
 * explicitly by scripts/worker.mjs) — do NOT put secrets in this file.
 *
 * Usage:
 *   npm ci && npm run build        # build first (also seeds/migrates the DB)
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup systemd
 */
module.exports = {
  apps: [
    {
      name: 'netwarden-web',
      // scripts/next.mjs resolves the correct Next bin, injects `-p $PORT`,
      // and adds the react-server import condition for the web app itself.
      script: 'scripts/next.mjs',
      args: 'start',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3051',
      },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'netwarden-worker',
      script: 'scripts/worker.mjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // The worker imports `.ts` modules via Node native type-stripping and
      // needs the react-server condition (matches `npm run worker`).
      node_args: '--conditions=react-server',
      env: {
        NODE_ENV: 'production',
        TZ: 'Australia/Sydney',
        // ROUTER_PROVIDER / SYNC_INTERVAL_SEC / router creds come from .env.local.
      },
      autorestart: true,
    },
  ],
};
