// Separate process from the Next app (no instrumentation.ts).
//
// Usage:
//   TZ=Australia/Sydney SYNC_INTERVAL_SEC=60 node --conditions=react-server scripts/worker.mjs
//
// Provider mode follows ROUTER_PROVIDER (loaded from .env.local, same as the web app):
//   fake → in-process FakeRouterProvider, ZERO network/router calls (safe to run anywhere).
//   asus → real AsusWrtProvider; the worker drives the SAME router as the web app so
//          deferred jobs (scheduled unblock, sync, reconcile) actually take effect.
//
// NOTE: --conditions=react-server is REQUIRED for the audit drain and AsusWrtProvider/secrets
//       (they import 'server-only', which resolves to a no-op under this condition).
// NOTE: TZ=Australia/Sydney is REQUIRED — schedules evaluate in AEST.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DB_PATH = path.join(repoRoot, 'netwarden.sqlite');

// ---------------------------------------------------------------------------
// Environment — Next.js auto-loads .env.local, but this standalone worker does
// not. Load it here so ROUTER_PROVIDER and the ASUS router credentials/secret
// keys match the web app. Explicit env (e.g. set on the npm script) wins.
// ---------------------------------------------------------------------------
for (const file of ['.env.local', '.env']) {
  const p = path.join(repoRoot, file);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch (err) {
      console.error(`[worker] Failed to load ${file}: ${err?.message ?? err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Guard: ROUTER_PROVIDER — 'fake' (in-process) or 'asus' (real router).
// asus is now supported: the worker must drive the SAME router as the web app,
// otherwise deferred jobs (scheduled unblock, sync, reconcile) operate on a
// different provider than the one that applied the block.
// ---------------------------------------------------------------------------
const providerMode = process.env.ROUTER_PROVIDER || 'fake';
if (!process.env.ROUTER_PROVIDER) {
  console.warn('[worker] ROUTER_PROVIDER is unset — defaulting to "fake" (in-process, no real router). Set ROUTER_PROVIDER=asus in .env.local to drive the real router.');
}

if (providerMode !== 'fake' && providerMode !== 'asus') {
  console.error(
    `[worker] Unknown ROUTER_PROVIDER="${providerMode}". Use "fake" or "asus".`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Retention days
// ---------------------------------------------------------------------------
const retentionDays = Math.max(1, parseInt(process.env.RAW_EVENT_RETENTION_DAYS ?? '30', 10) || 30);

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
// Guard: TELEMETRY_INGEST_SEC
// ---------------------------------------------------------------------------
const telemetryIngestSec = parseInt(process.env.TELEMETRY_INGEST_SEC || '300', 10);
if (!Number.isInteger(telemetryIngestSec) || telemetryIngestSec <= 0) {
  console.error(
    `[worker] TELEMETRY_INGEST_SEC must be a positive integer (got "${process.env.TELEMETRY_INGEST_SEC}"). Set e.g. TELEMETRY_INGEST_SEC=300.`,
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

// Idempotent retention schedule (find-or-create) — runs daily at 03:00.
const retentionCron = '0 3 * * *';
const existingRetention = schedules.find((s) => s.type === 'netwarden.retention');

if (!existingRetention) {
  const createdRetention = await jobs.schedules.create({
    name: 'netwarden-retention',
    cron: retentionCron,
    type: 'netwarden.retention',
    payload: {},
    maxAttempts: 1,
  });
  console.log(`[worker] Created recurring schedule: id=${createdRetention.id}, cron="${retentionCron}", next_run_at=${createdRetention.next_run_at}`);
} else {
  console.log(`[worker] Reusing existing schedule id=${existingRetention.id} (type=netwarden.retention, cron="${existingRetention.cron ?? retentionCron}")`);
}

const ingestMinutes = Math.max(1, Math.round(telemetryIngestSec / 60));
const ingestCron = ingestMinutes === 1 ? '* * * * *' : `*/${ingestMinutes} * * * *`;

// Idempotent ingest schedule (find-or-create) — telemetry domain-event ingest.
const existingIngest = schedules.find((s) => s.type === 'netwarden.ingest');
if (!existingIngest) {
  const createdIngest = await jobs.schedules.create({
    name: 'netwarden-ingest',
    cron: ingestCron,
    type: 'netwarden.ingest',
    payload: {},
    maxAttempts: 1,
  });
  console.log(`[worker] Created recurring schedule: id=${createdIngest.id}, cron="${ingestCron}", next_run_at=${createdIngest.next_run_at}`);
} else {
  console.log(`[worker] Reusing existing schedule id=${existingIngest.id} (type=netwarden.ingest, cron="${existingIngest.cron ?? ingestCron}")`);
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
const { FakeRouterProvider, fakeRouterStatePath } = await import('../src/server/router/FakeRouterProvider.ts');
// AsusWrtProvider is imported lazily (only in asus mode) so fake-mode runs never
// pull in 'server-only' / secrets / hazo_secure.
const { runDeviceSync } = await import('../src/server/sync/runDeviceSync.ts');
const { pruneEvents } = await import('../src/server/retention/pruneEvents.ts');
const { runTelemetryIngest } = await import('../src/server/telemetry/runTelemetryIngest.ts');
const { FakeTelemetryProvider } = await import('../src/server/telemetry/FakeTelemetryProvider.ts');

// ---------------------------------------------------------------------------
// Ops alerting (best-effort — Telegram-direct; no-op when TELEGRAM_* unset)
// ---------------------------------------------------------------------------
const { createNotifyProvider, isNotifyConfigured } = await import('../src/server/notify/NotifyProvider.ts');
const notify = createNotifyProvider();
console.log(`[worker] Ops alerting: ${isNotifyConfigured() ? 'enabled' : 'disabled (TELEGRAM_* unset)'}`);

let provider;
if (providerMode === 'asus') {
  const { AsusWrtProvider } = await import('../src/server/router/AsusWrtProvider.ts');
  provider = new AsusWrtProvider();
  // Fail fast with a clear message if credentials/router are unreachable, so a
  // mis-config surfaces at boot rather than silently as never-firing unblocks.
  try {
    await provider.login();
    console.log('[worker] ASUS router login OK.');
  } catch (err) {
    console.error(`[worker] ASUS router login FAILED: ${err?.message ?? err}`);
    console.error('[worker] Check ROUTER_* credentials in .env.local and router reachability.');
    process.exit(1);
  }
} else {
  // Share block state with the web process via a file so a scheduled unblock
  // fired here isn't resurrected by the web app's pull-reconcile (and vice-versa).
  // No file-locking is needed on this shared state file: the single-threaded web
  // process and this single worker serialize their writes (last-writer-wins is
  // acceptable for the fake provider, which is dev/test-only). asus mode does not
  // touch this file at all.
  provider = new FakeRouterProvider(undefined, { persistPath: fakeRouterStatePath() });
}
const telemetryProvider = new FakeTelemetryProvider();

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------
console.log('[worker] ─── NetWarden Sync Worker ───────────────────────────────');
console.log(`[worker] DB path:       ${DB_PATH}`);
console.log(`[worker] Provider mode: ${providerMode}`);
console.log(`[worker] Interval:      ${intervalSec}s → cron "${cron}" (every ${minutes} minute(s))`);
console.log(`[worker] Ingest:        ${telemetryIngestSec}s → cron "${ingestCron}" (every ${ingestMinutes} minute(s))`);
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
  types: ['netwarden.sync', 'netwarden.retention', 'netwarden.block', 'netwarden.unblock', 'netwarden.ingest'],
  pollMs: 1_000,
  concurrency: 1,
});

const handler = async (job) => {
  if (job.type === 'netwarden.retention') {
    try {
      const result = await pruneEvents(adapter, { retentionDays });
      console.log('[worker] netwarden.retention pruned', job.id, JSON.stringify(result));
      return result;
    } catch (err) {
      await notify.alert({ title: '🔴 NetWarden retention prune failed', body: String(err?.message ?? err), dedupeKey: 'retention-failure' });
      throw err;
    }
  }
  if (job.type === 'netwarden.block' || job.type === 'netwarden.unblock') {
    const p = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload ?? {});
    let result;
    try {
      const { runScheduleFire } = await import('../src/server/schedules/runScheduleFire.ts');
      result = await runScheduleFire(auditAdapter, provider, {
        targetType: p.targetType,
        targetId: p.targetId,
        action: p.action,
        scheduleId: p.scheduleId,
      });
    } catch (err) {
      await notify.alert({ title: '🔴 NetWarden schedule fire failed', body: String(err?.message ?? err), dedupeKey: 'schedule-failure' });
      throw err;
    }
    const { notifyScheduleFired } = await import('../src/server/notify/events.ts');
    await notifyScheduleFired(notify, { action: p.action, targetType: p.targetType, targetId: p.targetId, affected: result.affected.length });
    console.log('[worker] schedule fire', job.id, JSON.stringify(result));
    try {
      await auditWorker.drainOnce();
    } catch (e) {
      console.warn('[worker] audit drain failed', e?.message ?? e);
    }
    return result;
  }
  if (job.type === 'netwarden.ingest') {
    let summary;
    try {
      summary = await runTelemetryIngest(adapter, telemetryProvider, new Date().toISOString());
    } catch (err) {
      await notify.alert({ title: '🔴 NetWarden telemetry ingest failed', body: String(err?.message ?? err), dedupeKey: 'ingest-failure' });
      throw err;
    }
    if (summary.configured === false) {
      const { notifyTelemetryGap } = await import('../src/server/notify/events.ts');
      await notifyTelemetryGap(notify, { reason: 'telemetry provider not configured' });
    }
    console.log('[worker] netwarden.ingest processed job', job.id, JSON.stringify(summary));
    return summary;
  }
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
  if (summary?.inserted > 0) {
    const { notifyNewDevices } = await import('../src/server/notify/events.ts');
    await notifyNewDevices(notify, { count: summary.inserted });
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
console.log('[worker] Worker started (pollMs=1000, concurrency=1, types=netwarden.sync|retention|block|unblock|ingest).');

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

const bootIngestJob = await jobs.submit({
  type: 'netwarden.ingest',
  description: 'worker boot ingest',
  payload: { boot: true },
  maxAttempts: 1,
  runAt: new Date().toISOString(),
});
console.log(`[worker] Boot-time ingest one-shot submitted: jobId=${bootIngestJob.jobId}`);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`[worker] Received ${signal} — shutting down gracefully...`);
  await worker.stop();
  scheduler.stop();
  try { await auditWorker.stop(); } catch (err) { console.error(`[worker] auditWorker.stop() failed during shutdown: ${err?.message ?? err}`); }
  try { if (typeof auditAdapter.close === 'function') auditAdapter.close(); } catch (err) { console.error(`[worker] auditAdapter.close() failed during shutdown: ${err?.message ?? err}`); }
  adapter.close();
  console.log('[worker] Clean shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the process alive until worker.stop() is called (via signal handler above).
await runPromise;
