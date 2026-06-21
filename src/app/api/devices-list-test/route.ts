/**
 * src/app/api/devices-list-test/route.ts
 *
 * Hermetic autotest for mergeBlockState (the pure block-annotation helper in deviceService).
 *
 * Lifecycle:
 * 1. Spin up a throwaway temp SQLite DB and run all migrations.
 * 2. Insert two devices d1, d2 (online). Insert app_block_state for d1 (is_blocked=1)
 *    and d2 (is_blocked=0).
 * 3. List both tables and call mergeBlockState — assert merged_ok:
 *    d1.is_blocked===1 and d2.is_blocked===0.
 * 4. Assert pure_ok: calling mergeBlockState with empty block rows yields all is_blocked===0
 *    (helper purity / no crash on empty input).
 * 5. Return JSON with flags + all_ok.
 *
 * Returns 404 in production (test-only route).
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { mergeBlockState } from '@/server/devices/deviceService';
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
    `netwarden_devices_list_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
    });

    // 1. Run all migrations.
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    const nowIso = new Date().toISOString();

    // 2. Insert two devices.
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd1', mac: 'AA:BB:CC:00:00:01', status: 'online', last_seen: nowIso,
    });
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd2', mac: 'AA:BB:CC:00:00:02', status: 'online', last_seen: nowIso,
    });

    // Insert app_block_state for d1 (blocked) and d2 (not blocked).
    const blockSvc = createCrudService(adapter, 'app_block_state', {
      primaryKeys: ['device_id'],
      autoId: false,
    });
    await blockSvc.insert({
      device_id: 'd1',
      is_blocked: 1,
      blocked_by: 'tester',
      blocked_at: nowIso,
      reason: null,
      scheduled_unblock_at: null,
      unblock_job_id: null,
      router_synced: 0,
    });
    await blockSvc.insert({
      device_id: 'd2',
      is_blocked: 0,
      blocked_by: null,
      blocked_at: null,
      reason: null,
      scheduled_unblock_at: null,
      unblock_job_id: null,
      router_synced: 0,
    });

    // 3. List both tables and call mergeBlockState.
    const deviceRows = await createCrudService(adapter, 'app_devices').list() as { id?: string }[];
    const blockRows = await createCrudService(adapter, 'app_block_state', {
      primaryKeys: ['device_id'],
      autoId: false,
    }).list() as { device_id?: string; is_blocked?: number }[];

    const merged = mergeBlockState(deviceRows, blockRows);
    const m1 = merged.find((d) => d.id === 'd1');
    const m2 = merged.find((d) => d.id === 'd2');
    const merged_ok = m1 !== undefined && m2 !== undefined &&
      m1.is_blocked === 1 && m2.is_blocked === 0;

    // 4. Assert pure_ok: empty block rows → all is_blocked===0.
    const mergedEmpty = mergeBlockState(deviceRows, []);
    const pure_ok = mergedEmpty.every((d) => d.is_blocked === 0);

    const all_ok = merged_ok && pure_ok;

    return Response.json({
      ok: true,
      all_ok,
      merged_ok,
      pure_ok,
      _d1_is_blocked: m1?.is_blocked,
      _d2_is_blocked: m2?.is_blocked,
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
