/**
 * src/app/api/retention-test/route.ts
 *
 * Hermetic autotest for retention pruning of app_domain_events.
 *
 * Lifecycle:
 * 1. Spin up a throwaway temp SQLite DB and run all migrations.
 * 2. Insert two OLD events (ts = 60 days ago) and two RECENT events (ts = 1 day ago).
 * 3. Insert two app_domain_rollup_daily rows and one app_device_presence row.
 * 4. Call pruneEvents with retentionDays=30 and a fixed 'now'.
 * 5. Assert: cutoff is pure, deleted===2, old rows gone, recent rows kept,
 *    rollup rows untouched, presence rows untouched.
 *
 * Returns 404 in production (test-only route).
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { computeCutoff, pruneEvents } from '@/server/retention/pruneEvents';
import os from 'os';
import path from 'path';
import fs from 'fs';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_retention_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
    });

    // 1. Run all migrations.
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    // Fixed reference point for the prune call.
    const fixedNow = new Date('2026-06-21T12:00:00.000Z');

    // Timestamps: 60 days ago (stale) and 1 day ago (recent).
    const old60 = new Date(fixedNow.getTime() - 60 * 86_400_000).toISOString();
    const recent1 = new Date(fixedNow.getTime() - 1 * 86_400_000).toISOString();

    // 2. Insert two OLD events and two RECENT events.
    const events = createCrudService(adapter, 'app_domain_events');
    await events.insert({ id: 'evt-old-1', device_id: 'dev-a', domain: 'old.example.com', ts: old60 });
    await events.insert({ id: 'evt-old-2', device_id: 'dev-b', domain: 'old2.example.com', ts: old60 });
    await events.insert({ id: 'evt-new-1', device_id: 'dev-a', domain: 'new.example.com', ts: recent1 });
    await events.insert({ id: 'evt-new-2', device_id: 'dev-b', domain: 'new2.example.com', ts: recent1 });

    // 3. Insert rollup rows — these must survive pruning.
    // app_domain_rollup_daily has a composite PK (device_id, domain, day) with no id column,
    // so we use rawQuery directly instead of createCrudService.
    await (adapter as any).rawQuery(
      `INSERT INTO app_domain_rollup_daily (device_id, domain, day, query_count, first_seen, last_seen, est_active_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      { params: ['dev-a', 'example.com', '2026-04-01', 5, '2026-04-01T00:00:00.000Z', '2026-04-01T23:00:00.000Z', 10] },
    );
    await (adapter as any).rawQuery(
      `INSERT INTO app_domain_rollup_daily (device_id, domain, day, query_count, first_seen, last_seen, est_active_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      { params: ['dev-b', 'other.com', '2026-04-02', 3, '2026-04-02T00:00:00.000Z', '2026-04-02T23:00:00.000Z', 5] },
    );

    // app_device_presence also has a composite PK — use rawQuery.
    await (adapter as any).rawQuery(
      `INSERT INTO app_device_presence (device_id, day, connected_minutes) VALUES (?, ?, ?)`,
      { params: ['dev-a', '2026-06-20', 120] },
    );

    // 4. Call pruneEvents with retentionDays=30 and fixed now.
    const result = await pruneEvents(adapter as any, { retentionDays: 30, now: fixedNow });

    // ── Checks ──────────────────────────────────────────────────────────────

    // Pure cutoff: 30 days before 2026-01-31T00:00:00.000Z === 2026-01-01T00:00:00.000Z
    const cutoff_is_pure_ok =
      computeCutoff(new Date('2026-01-31T00:00:00.000Z'), 30) === '2026-01-01T00:00:00.000Z';

    // pruneEvents returned deleted===2
    const deleted_count_ok = result.deleted === 2;

    // Old rows gone: COUNT(*) of events with ts < cutoff === 0
    const afterOldRows = await (adapter as any).rawQuery(
      'SELECT COUNT(*) AS n FROM app_domain_events WHERE ts < ?',
      { params: [result.cutoff] },
    );
    const oldGoneCount: number = afterOldRows[0]?.n ?? afterOldRows[0]?.['COUNT(*)'] ?? -1;
    const old_rows_gone_ok = oldGoneCount === 0;

    // Recent rows kept: total events remaining === 2
    const afterAllRows = await (adapter as any).rawQuery(
      'SELECT COUNT(*) AS n FROM app_domain_events',
      { params: [] },
    );
    const remainingCount: number = afterAllRows[0]?.n ?? afterAllRows[0]?.['COUNT(*)'] ?? -1;
    const recent_rows_kept_ok = remainingCount === 2;

    // Rollup rows untouched: app_domain_rollup_daily count === 2
    const rollupRows = await (adapter as any).rawQuery(
      'SELECT COUNT(*) AS n FROM app_domain_rollup_daily',
      { params: [] },
    );
    const rollupCount: number = rollupRows[0]?.n ?? rollupRows[0]?.['COUNT(*)'] ?? -1;
    const rollups_untouched_ok = rollupCount === 2;

    // Presence rows untouched: app_device_presence count === 1
    const presenceRows = await (adapter as any).rawQuery(
      'SELECT COUNT(*) AS n FROM app_device_presence',
      { params: [] },
    );
    const presenceCount: number = presenceRows[0]?.n ?? presenceRows[0]?.['COUNT(*)'] ?? -1;
    const presence_untouched_ok = presenceCount === 1;

    const all_ok =
      cutoff_is_pure_ok &&
      deleted_count_ok &&
      old_rows_gone_ok &&
      recent_rows_kept_ok &&
      rollups_untouched_ok &&
      presence_untouched_ok;

    return Response.json({
      ok: true,
      all_ok,
      cutoff_is_pure_ok,
      deleted_count_ok,
      old_rows_gone_ok,
      recent_rows_kept_ok,
      rollups_untouched_ok,
      presence_untouched_ok,
      _result: result,
      _oldGoneCount: oldGoneCount,
      _remainingCount: remainingCount,
      _rollupCount: rollupCount,
      _presenceCount: presenceCount,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    } catch {
      // best-effort cleanup
    }
  }
}
