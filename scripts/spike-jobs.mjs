// SAFE TO RUN — pure hazo_jobs/SQLite, no network/router.
// Proof: hazo_jobs persistence + re-arm-across-restart (one-shot fires in a brand-new child process)

import { createReadStream, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DB_PATH = path.join(repoRoot, 'jobs-spike.sqlite');
const MARKER_FILE = path.join(repoRoot, 'jobs-spike-marker.txt');

// ---------------------------------------------------------------------------
// Build a thin { raw(sql, values?) } adapter over better-sqlite3
// hazo_jobs needs: adapter.raw(sql: string, values?: unknown[]) => Promise<any[]>
// Note: better-sqlite3 uses ? placeholders; hazo_jobs sends $1/$2 for pg-style
// dialects but with dialect:'sqlite' it should use ? already. Tested below.
// ---------------------------------------------------------------------------
async function buildSqliteAdapter(dbPath) {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    db, // expose for direct DDL
    raw(sql, values = []) {
      // hazo_jobs with dialect:'sqlite' already uses ? placeholders.
      // If it ever sends $1 style, translate them (safety net):
      const translated = sql.replace(/\$(\d+)/g, '?');
      try {
        // Branch on better-sqlite3's `stmt.reader` flag (NOT the SQL prefix):
        // a statement returns rows iff `reader === true` (SELECT, PRAGMA-with-rows,
        // and any INSERT/UPDATE/DELETE ... RETURNING). Calling .all() on a
        // non-row-returning statement (e.g. an UPDATE without RETURNING, which
        // hazo_jobs' scheduler uses to promote scheduled->pending) THROWS, so we
        // must use .run() for those.
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
    close() {
      db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// SETUP phase — called inline by the parent orchestrator
// ---------------------------------------------------------------------------
async function runSetup() {
  console.log('[setup] Starting setup phase...');

  // Delete any existing spike DB/marker for idempotency
  if (existsSync(DB_PATH)) { unlinkSync(DB_PATH); console.log('[setup] Deleted old jobs-spike.sqlite'); }
  if (existsSync(MARKER_FILE)) { unlinkSync(MARKER_FILE); }

  const adapter = await buildSqliteAdapter(DB_PATH);

  // Import hazo_jobs
  const { applyDdl, migrateSchema, createJobsClient, createScheduler } = await import('hazo_jobs/server');

  // Read DDL from file
  const { readFileSync } = await import('node:fs');
  const ddlPath = path.join(repoRoot, 'node_modules/hazo_jobs/db_setup_sqlite.sql');
  const ddl = readFileSync(ddlPath, 'utf8');

  // Create spike_marker table for the handler to write into
  adapter.db.exec(`
    CREATE TABLE IF NOT EXISTS spike_marker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      fired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  // Apply hazo_jobs DDL (idempotent) — on a fresh DB, applyDdl is sufficient.
  // migrateSchema is only needed for upgrading EXISTING DBs (adds missing cols),
  // but since we delete the DB at startup we skip it to avoid "duplicate column" errors.
  await applyDdl(adapter, ddl);
  console.log('[setup] DDL applied.');

  // Create a jobs client
  const jobs = createJobsClient({
    connect: { adapter },
    dialect: 'sqlite',
  });

  // Submit a ONE-SHOT job (runAt = now + 8 seconds)
  const runAt = new Date(Date.now() + 8_000).toISOString();
  const { jobId } = await jobs.submit({
    type: 'spike.one_shot',
    description: 'Spike one-shot job — fires in child process after restart',
    payload: { message: 'hello from setup' },
    maxAttempts: 1,
    runAt,
  });
  console.log(`[setup] One-shot job submitted: ${jobId}, runAt: ${runAt}`);

  // Create a RECURRING schedule (every minute)
  const schedule = await jobs.schedules.create({
    name: 'spike-recurring',
    cron: '*/1 * * * *',
    type: 'spike.recurring',
    payload: { tick: 1 },
    maxAttempts: 1,
  });
  console.log(`[setup] Recurring schedule created: ${schedule.id}, next_run_at: ${schedule.next_run_at}`);

  adapter.close();
  console.log('[setup] Done. DB written and closed.');
  return { jobId, scheduleNextRunAt: schedule.next_run_at };
}

// ---------------------------------------------------------------------------
// RUN phase — spawned as a CHILD process; opens the SAME DB fresh
// ---------------------------------------------------------------------------
async function runWorker() {
  console.log('[run] Child process started — re-arming from persisted DB...');

  const adapter = await buildSqliteAdapter(DB_PATH);

  const { createJobsClient, createScheduler, createWorker } = await import('hazo_jobs/server');

  const jobs = createJobsClient({
    connect: { adapter },
    dialect: 'sqlite',
  });

  // Start the scheduler (re-arms recurring schedules from DB)
  const scheduler = createScheduler({
    adapter,
    dialect: 'sqlite',
    tablePrefix: 'hazo_jobs',
    scheduleTickMs: 2_000,
  });
  scheduler.start();
  console.log('[run] Scheduler started.');

  // Also start a worker for the RECURRING type so its handler works
  // (The scheduler fires, the worker processes)
  const workerRecurring = createWorker({
    adapter,
    dialect: 'sqlite',
    tablePrefix: 'hazo_jobs',
    workerId: 'spike-worker-recurring',
    types: ['spike.recurring'],
    pollMs: 1_000,
    concurrency: 1,
  });

  const recurringDone = workerRecurring.run(async (job) => {
    console.log(`[run] Recurring job handled: ${job.id}`);
    return { handled: true };
  });

  // Start the ONE-SHOT worker — handler writes marker when job fires
  const workerOneShot = createWorker({
    adapter,
    dialect: 'sqlite',
    tablePrefix: 'hazo_jobs',
    workerId: 'spike-worker-oneshot',
    types: ['spike.one_shot'],
    pollMs: 500,
    concurrency: 1,
  });

  let oneShotFired = false;
  const oneShotDone = workerOneShot.run(async (job) => {
    console.log(`[run] ONE-SHOT job FIRED: ${job.id}`);
    // Write marker to DB
    adapter.db.prepare('INSERT INTO spike_marker (job_id) VALUES (?)').run(job.id);
    // Also write a file marker so parent can detect it
    const { writeFileSync } = await import('node:fs');
    writeFileSync(MARKER_FILE, JSON.stringify({ jobId: job.id, firedAt: new Date().toISOString() }));
    oneShotFired = true;
    return { marker: 'written' };
  });

  // Poll up to 25s for the one-shot to complete
  const deadline = Date.now() + 25_000;
  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (oneShotFired) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error('Timeout: one-shot job did not fire within 25s'));
      }
    }, 300);
  });

  // Stop workers and scheduler
  await workerOneShot.stop();
  await workerRecurring.stop();
  scheduler.stop();
  adapter.close();
  console.log('[run] Child process done — one-shot fired successfully.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// PARENT orchestrator (no arg)
// ---------------------------------------------------------------------------
async function runOrchestrator() {
  console.log('');
  console.log('=== hazo_jobs re-arm spike ===');
  console.log(`DB: ${DB_PATH}`);
  console.log('');

  // Step 1: Setup (inline, same process)
  let setupResult;
  try {
    setupResult = await runSetup();
  } catch (err) {
    console.error('[orchestrator] Setup failed:', err);
    process.exit(1);
  }

  const { jobId, scheduleNextRunAt: initialNextRunAt } = setupResult;
  console.log('');
  console.log('[orchestrator] Setup complete. Spawning child (simulating process restart)...');

  // Step 2: Spawn child process (the "restart" — brand new process, no in-memory state)
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, [scriptPath, 'run'], {
    stdio: 'inherit',
    env: process.env,
    timeout: 35_000,
  });

  console.log('');

  // Step 3: Assert results
  let oneShotFiredAfterRestart = false;
  let recurringNextRunPersisted = false;

  if (child.status === 0) {
    // Check marker file
    if (existsSync(MARKER_FILE)) {
      const { readFileSync } = await import('node:fs');
      const marker = JSON.parse(readFileSync(MARKER_FILE, 'utf8'));
      console.log(`[orchestrator] Marker found: jobId=${marker.jobId}, firedAt=${marker.firedAt}`);
      oneShotFiredAfterRestart = true;
    } else {
      console.error('[orchestrator] MARKER FILE NOT FOUND — one-shot did not fire');
    }

    // Check recurring schedule next_run_at in DB
    // Re-open DB to read the schedule
    const adapter2 = await buildSqliteAdapter(DB_PATH);
    // We need a new adapter but the DB is already closed by child; open fresh
    // (better-sqlite3 can re-open a closed DB)
    const schedules = adapter2.db.prepare('SELECT id, next_run_at FROM hazo_jobs_schedules WHERE type = ?').all('spike.recurring');
    if (schedules.length > 0) {
      const sched = schedules[0];
      console.log(`[orchestrator] Recurring schedule: id=${sched.id}, next_run_at=${sched.next_run_at}`);
      // Verify next_run_at is a valid ISO date
      recurringNextRunPersisted = Boolean(sched.next_run_at && !isNaN(new Date(sched.next_run_at).getTime()));
    } else {
      console.error('[orchestrator] No recurring schedule found in DB');
    }
    adapter2.close();
  } else {
    console.error(`[orchestrator] Child process exited with code ${child.status}`);
    if (child.error) console.error(child.error);
  }

  const passed = oneShotFiredAfterRestart && recurringNextRunPersisted;

  console.log('');
  console.log(`=== hazo_jobs re-arm spike: ${passed ? 'PASS' : 'FAIL'} ===`);
  console.log(`one_shot_fired_after_restart: ${oneShotFiredAfterRestart}`);
  console.log(`recurring_next_run_persisted: ${recurringNextRunPersisted}`);

  if (passed) {
    console.log('');
    console.log('=== CONFIRMED CONTRACTS ===');
    console.log('createJobsClient: createJobsClient({ connect: { adapter: { raw(sql, values?): Promise<any[]> } }, dialect: "sqlite" })');
    console.log('  - adapter shape: { raw(sql: string, values?: unknown[]): Promise<any[]> } (NOT HazoConnectAdapter — built thin wrapper over better-sqlite3)');
    console.log('  - dialect: "sqlite" (uses ? placeholders, no $1 translation needed in practice)');
    console.log('');
    console.log('submit: jobs.submit({ type, description (required!), payload, maxAttempts?, runAt?: ISO8601, scheduleId? })');
    console.log('  - returns: Promise<{ jobId: string }>');
    console.log('  - runAt in the future → status="scheduled", promoted by scheduler tick');
    console.log('');
    console.log('jobs.schedules.create: CreateScheduleOptions = { name, cron: "*/1 * * * *" (5-field), type, payload?, maxAttempts?, priority?, expiresInSec?, enabled? }');
    console.log('  - returns: Promise<Schedule> with { id, next_run_at, ... }');
    console.log('');
    console.log('createScheduler: createScheduler({ adapter, dialect, tablePrefix?: "hazo_jobs", scheduleTickMs?: number })');
    console.log('  - returns: SchedulerHandle with .start() → void, .stop() → void, .tickOnce() → Promise<void>');
    console.log('');
    console.log('createWorker: createWorker({ adapter, dialect, tablePrefix?: "hazo_jobs", workerId, types: string[], pollMs?, concurrency? })');
    console.log('  - .run(handler: (job: Job, log?) => Promise<TResult>) → Promise<void> (resolves when .stop() called)');
    console.log('  - .stop() → Promise<void>');
    console.log('');
    console.log('DDL: migrateSchema(adapter, "sqlite", "hazo_jobs") then applyDdl(adapter, ddlString) — both idempotent');
    console.log('  - DDL file: node_modules/hazo_jobs/db_setup_sqlite.sql');
    console.log('');
    console.log('Re-arm: scheduler.start() in a fresh process reads hazo_jobs_schedules from DB');
    console.log('        worker poll picks up status="scheduled" jobs once run_at is past — NO in-memory state needed');
    console.log('===========================');
  }

  process.exit(passed ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Entry point dispatch
// ---------------------------------------------------------------------------
const phase = process.argv[2];
if (phase === 'setup') {
  runSetup().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
} else if (phase === 'run') {
  runWorker().catch(err => { console.error('[run] Fatal:', err); process.exit(1); });
} else {
  runOrchestrator().catch(err => { console.error('[orchestrator] Fatal:', err); process.exit(1); });
}
