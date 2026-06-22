/**
 * src/app/api/reconcile-test/route.ts
 *
 * Hermetic autotest for the drift-reconcile pass in runDeviceSync.
 *
 * Lifecycle:
 * 1. Spin up a throwaway temp SQLite DB and run all migrations.
 * 2. Insert device d1 (online) and an app_block_state row marking it blocked
 *    with router_synced=1 (previously synced).
 * 3. Force drift: fake.forceBlockState(mac, false) — router "lost" the block.
 * 4. DRIFT case: run runDeviceSync → assert reapplied===1, router re-blocked,
 *    router_synced flipped to 1, and audit intent row emitted.
 * 5. NO-DRIFT case: run again (router now shows blocked) → assert reapplied===0.
 * 6. Return JSON with all assertion flags + all_ok.
 *
 * Returns 404 in production (test-only route).
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runDeviceSync } from '@/server/sync/runDeviceSync';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Cast shim: hazo_connect adapter satisfies SyncAdapter at runtime even though
// the generic type reflects PostgREST options.
type SyncAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const tmpDb = path.join(
    os.tmpdir(),
    `darylweb_reconcile_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const rawAdapter = createHazoConnect({
      type: 'sqlite',
      sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
    });
    const adapter = rawAdapter as unknown as SyncAdapter;

    // 1. Run all migrations.
    await runMigrations(rawAdapter, { directory: MIGRATIONS_DIR });

    const nowIso = new Date().toISOString();

    // 2. Insert device d1.
    await createCrudService(rawAdapter, 'app_devices').insert({
      id: 'd1',
      mac: 'AA:BB:CC:00:00:99',
      status: 'online',
      last_seen: nowIso,
    });

    // Insert app_block_state for d1: blocked, router_synced=1 (previously synced).
    await createCrudService(rawAdapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false }).insert({
      device_id: 'd1',
      is_blocked: 1,
      blocked_by: 'tester',
      blocked_at: nowIso,
      reason: null,
      scheduled_unblock_at: null,
      unblock_job_id: null,
      router_synced: 1,
    });

    // 3. Create fake provider.
    const fake = new FakeRouterProvider();

    // Force drift: router has "forgotten" the block.
    fake.forceBlockState('AA:BB:CC:00:00:99', false);

    // 4. DRIFT case: run sync.
    const summary = await runDeviceSync(adapter, fake, nowIso, { intervalSec: 60 });

    // Assert: reapplied === 1.
    const reapply_ok = summary.reapplied === 1;

    // Assert: router is now re-blocked.
    const routerBlocked = await fake.getBlockState('AA:BB:CC:00:00:99');
    const router_reblocked_ok = routerBlocked === true;

    // Assert: app_block_state.router_synced for d1 === 1.
    const stateRow = await createCrudService(rawAdapter, 'app_block_state', {
      primaryKeys: ['device_id'],
      autoId: false,
    }).findById('d1') as Record<string, unknown> | null;
    const synced_ok = stateRow !== null && Number(stateRow.router_synced) === 1;

    // Assert: audit intent row emitted with event_name=device_block_reapplied, subject_id=d1.
    const intentRows = await createCrudService(rawAdapter, 'hazo_audit_intent').findBy({
      event_name: 'device_block_reapplied',
      subject_id: 'd1',
    });
    const audit_ok = intentRows.length >= 1;

    // 5. NO-DRIFT case: router is now correctly blocked — run again.
    const summary2 = await runDeviceSync(adapter, fake, nowIso, { intervalSec: 60 });
    const no_redundant_reapply_ok = summary2.reapplied === 0;

    const all_ok = reapply_ok && router_reblocked_ok && synced_ok && audit_ok && no_redundant_reapply_ok;

    return Response.json({
      ok: true,
      all_ok,
      reapply_ok,
      router_reblocked_ok,
      synced_ok,
      audit_ok,
      no_redundant_reapply_ok,
      _summary: summary,
      _summary2: summary2,
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
