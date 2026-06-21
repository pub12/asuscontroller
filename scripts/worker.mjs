// SAFE TO RUN locally — pure hazo_jobs/SQLite + FakeRouterProvider, ZERO network/router calls.
// Separate process from the Next app (no instrumentation.ts).
//
// Usage:
//   ROUTER_PROVIDER=fake SYNC_INTERVAL_SEC=60 node --conditions=react-server scripts/worker.mjs
//
// NOTE: --conditions=react-server is REQUIRED for the audit drain (hazo_audit/server imports 'server-only').
//
// ROUTER_PROVIDER=asus is explicitly blocked — this build has no hardware access.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DB_PATH = path.join(repoRoot, 'netwarden.sqlite');

// ---------------------------------------------------------------------------
// Guard: ROUTER_PROVIDER
// ---------------------------------------------------------------------------
const providerMode = process.env.ROUTER_PROVIDER || 'fake';

if (providerMode === 'asus') {
  console.error(
    '[worker] ROUTER_PROVIDER=asus is not supported in this build (hardware-blocked). Set ROUTER_PROVIDER=fake.',
  );
  process.exit(1);
}

if (providerMode !== 'fake') {
  console.error(
    `[worker] Unknown ROUTER_PROVIDER="${providerMode}". Only "fake" is supported. Set ROUTER_PROVIDER=fake.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guard: SYNC_INTERVAL_SEC
// ---------------------------------------------------------------------------
const intervalSec = parseInt(process.env.SYNC_INTERVAL_SEC || '60', 10);

if (!Number.isInteger(intervalSec) || intervalSec <= 0) {
  console.error(
    `[worker] SYNC_INTERVAL_SEC must be a positive integer (got "${process.env.SYNC_INTERVAL_SEC}"). Set e.g. SYNC_INTERVAL_SEC=60.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build thin adapter over better-sqlite3
// Exposes:
//   raw(sql, values?)   — for hazo_jobs (stmt.reader branch; $1→? translation)
//   rawQuery(sql, opts) — for runDeviceSync (options.params style)
//   db                  — raw better-sqlite3 instance
//   close()             — close the DB connection
// ---------------------------------------------------------------------------
const Database = (await import('better-sqlite3')).default;
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const adapter = {
  db,

  // hazo_jobs adapter method — uses $1-style translation as a safety net
  raw(sql, values = []) {
    const translated = sql.replace(/\$(\d+)/g, '?');
    try {
      const stmt = db.prepare(translated);
      if (stmt.reader) {
        return Promise.resolve(stmt.all(...values));
      }
      stmt.run(...values);
      return Promise.resolve([]);
    } catch (err) {
      return Promise.reject(err);
    }
  },

  // runDeviceSync adapter method — options.params style
  rawQuery(sql, options = {}) {
    const rawParams = options.params ?? [];
    // Coerce booleans → 1/0 and undefined → null for SQLite compatibility
    const params = rawParams.map((v) => {
      if (v === undefined) return null;
      if (v === true) return 1;
      if (v === false) return 0;
      return v;
    });
    try {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        return Promise.resolve(stmt.all(...params));
      }
      stmt.run(...params);
      return Promise.resolve([]);
    } catch (err) {
      return Promise.reject(err);
    }
  },

  close() {
    db.close();
  },
};

// ---------------------------------------------------------------------------
// Apply hazo_jobs DDL (idempotent — uses CREATE TABLE IF NOT EXISTS)
// Safe on netwarden.sqlite which already has app_* tables but no hazo_jobs_* tables.
// ---------------------------------------------------------------------------
const { applyDdl, createJobsClient, createScheduler, createWorker } = await import('hazo_jobs/server');

const ddlPath = path.join(repoRoot, 'node_modules/hazo_jobs/db_setup_sqlite.sql');
const ddl = readFileSync(ddlPath, 'utf8');
await applyDdl(adapter, ddl);

// ---------------------------------------------------------------------------
// Jobs client
// ---------------------------------------------------------------------------
const jobs = createJobsClient({
  connect: { adapter },
  dialect: 'sqlite',
});

// ---------------------------------------------------------------------------
// Idempotent recurring schedule (find-or-create)
// cron granularity is 1 minute; sub-minute SYNC_INTERVAL_SEC is floored to a
// 1-minute cron — the scheduler tick handles promotion of pending jobs.
// ---------------------------------------------------------------------------
const minutes = Math.max(1, Math.round(intervalSec / 60));
const cron = minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`;

const schedules = await jobs.schedules.list();
const existing = schedules.find((s) => s.type === 'netwarden.sync');

if (!existing) {
  const created = await jobs.schedules.create({
    name: 'netwarden-sync',
    cron,
    type: 'netwarden.sync',
    payload: {},
    maxAttempts: 1,
  });
  console.log(`[worker] Created recurring schedule: id=${created.id}, cron="${cron}", next_run_at=${created.next_run_at}`);
} else {
  console.log(`[worker] Reusing existing schedule id=${existing.id} (type=netwarden.sync, cron="${existing.cron ?? cron}")`);
}

// ── Audit-outbox drain ──────────────────────────────────────────────────────
// startAuditWorker needs a full hazo_connect adapter (claimRows primitive); the
// thin adapter above only has raw/rawQuery. Open a 2nd better-sqlite3 connection
// to the SAME DB (WAL — safe; this worker is single-threaded). REQUIRES launching
// under `node --conditions=react-server` (hazo_audit/server imports 'server-only').
const { createHazoConnect } = await import('hazo_connect/server');
const { startAuditWorker } = await import('hazo_audit/server');
const auditAdapter = createHazoConnect({
  type: 'sqlite',
  sqlite: { database_path: DB_PATH, driver: 'better-sqlite3' },
});
await auditAdapter.rawQuery('PRAGMA busy_timeout = 5000', { params: [] });
const auditWorker = startAuditWorker({ app_adapter: auditAdapter });

// ---------------------------------------------------------------------------
// Import sync core and provider (dynamic import with .ts extension — Node v25
// native type-stripping; relative path required, no @/ alias resolution)
// ---------------------------------------------------------------------------
const { FakeRouterProvider } = await import('../src/server/router/FakeRouterProvider.ts');
const { runDeviceSync } = await import('../src/server/sync/runDeviceSync.ts');

// ---------------------------------------------------------------------------
// Ops alerting (best-effort — Telegram-direct; no-op when TELEGRAM_* unset)
// ---------------------------------------------------------------------------
const { createNotifyProvider, isNotifyConfigured } = await import('../src/server/notify/NotifyProvider.ts');
const notify = createNotifyProvider();
console.log(`[worker] Ops alerting: ${isNotifyConfigured() ? 'enabled' : 'disabled (TELEGRAM_* unset)'}`);

const provider = new FakeRouterProvider();

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------
console.log('[worker] ─── NetWarden Sync Worker ───────────────────────────────');
console.log(`[worker] DB path:       ${DB_PATH}`);
console.log(`[worker] Provider mode: ${providerMode}`);
console.log(`[worker] Interval:      ${intervalSec}s → cron "${cron}" (every ${minutes} minute(s))`);
console.log('[worker] ─────────────────────────────────────────────────────────');

// ---------------------------------------------------------------------------
// Scheduler + Worker
// ---------------------------------------------------------------------------
const scheduler = createScheduler({
  adapter,
  dialect: 'sqlite',
  tablePrefix: 'hazo_jobs',
  scheduleTickMs: 2_000,
});
scheduler.start();
console.log('[worker] Scheduler started (scheduleTickMs=2000).');

const worker = createWorker({
  adapter,
  dialect: 'sqlite',
  tablePrefix: 'hazo_jobs',
  workerId: 'netwarden-sync-worker',
  types: ['netwarden.sync'],
  pollMs: 1_000,
  concurrency: 1,
});

const handler = async (job) => {
  let summary;
  try {
    summary = await runDeviceSync(adapter, provider, new Date().toISOString(), { intervalSec });
  } catch (err) {
    // Best-effort ops alert — swallowed internally; rethrow so hazo_jobs records the failure.
    await notify.alert({
      title: '🔴 NetWarden sync failed',
      body: String(err?.message ?? err),
      dedupeKey: 'sync-failure',
    });
    throw err;
  }
  console.log('[worker] netwarden.sync processed job', job.id, JSON.stringify(summary));
  try {
    const drained = await auditWorker.drainOnce();
    console.log('[worker] audit drain', JSON.stringify(drained));
  } catch (err) {
    console.warn('[worker] audit drain failed (non-fatal):', err?.message ?? err);
  }
  return summary;
};

// Keep a reference to the run promise so we can await it at the end
// (worker.run resolves only when worker.stop() is called).
const runPromise = worker.run(handler);
console.log('[worker] Worker started (pollMs=1000, concurrency=1, type=netwarden.sync).');

// ---------------------------------------------------------------------------
// Boot-time immediate sync — submit a one-shot job with runAt=now so the
// worker processes it within a couple of seconds (no waiting for the first
// cron boundary). This ensures devices populate in the DB deterministically
// and makes the smoke test reliable.
// ---------------------------------------------------------------------------
const bootJob = await jobs.submit({
  type: 'netwarden.sync',
  description: 'worker boot sync',
  payload: { boot: true },
  maxAttempts: 1,
  runAt: new Date().toISOString(),
});
console.log(`[worker] Boot-time one-shot submitted: jobId=${bootJob.jobId}`);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`[worker] Received ${signal} — shutting down gracefully...`);
  await worker.stop();
  scheduler.stop();
  try { await auditWorker.stop(); } catch {}
  try { if (typeof auditAdapter.close === 'function') auditAdapter.close(); } catch {}
  adapter.close();
  console.log('[worker] Clean shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the process alive until worker.stop() is called (via signal handler above).
await runPromise;
