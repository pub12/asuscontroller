/**
 * src/app/api/policy-reconcile-test/route.ts
 * Hermetic autotest: policy-driven reconcile + manual-override hold + precedence.
 * Returns 404 in production.
 */
import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runDeviceSync } from '@/server/sync/runDeviceSync';
import os from 'os';
import path from 'path';
import fs from 'fs';

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });
  const tmpDb = path.join(os.tmpdir(), `darylweb_policy_reconcile_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`);
  const checks: Record<string, boolean> = {};
  try {
    const rawAdapter = createHazoConnect({ type: 'sqlite', sqlite: { database_path: tmpDb, driver: 'better-sqlite3' } });
    const adapter = rawAdapter as unknown as RawAdapter;
    await runMigrations(rawAdapter, { directory: MIGRATIONS_DIR });

    const provider = new FakeRouterProvider();
    const clients = await provider.getClientList();
    const mac = clients[0].mac; // an online device

    // Seed device d1 mapped to that MAC via an initial sync.
    const tBase = Date.parse('2026-06-22T07:00:00.000Z'); // Mon 17:00 Melbourne (winter)
    await runDeviceSync(adapter, provider, new Date(tBase).toISOString(), { intervalSec: 60 });
    const d1 = (await adapter.rawQuery(`SELECT id FROM app_devices WHERE mac = ?`, { params: [mac] }))[0].id;

    // Policy: blocked all day, allow 16:00-18:00 Mon (weekday 0). unblock@960, block@1080.
    const pid = 'pol_test';
    await adapter.rawQuery(
      `INSERT INTO app_schedule_policies (id, target_type, target_id, enabled, tz, created_at) VALUES (?, 'device', ?, 1, 'Australia/Melbourne', ?)`,
      { params: [pid, d1, new Date().toISOString()] });
    await adapter.rawQuery(`INSERT INTO app_schedule_rules (id,policy_id,weekday,time_min,action) VALUES ('r1',?,0,960,'unblock')`, { params: [pid] });
    await adapter.rawQuery(`INSERT INTO app_schedule_rules (id,policy_id,weekday,time_min,action) VALUES ('r2',?,0,1080,'block')`, { params: [pid] });

    const blocked = async () => Number((await adapter.rawQuery(`SELECT COALESCE(is_blocked,0) b FROM app_block_state WHERE device_id = ?`, { params: [d1] }))[0]?.b ?? 0) === 1;

    // (A) At 17:00 (inside window) reconcile -> unblocked.
    await runDeviceSync(adapter, provider, new Date(tBase).toISOString(), { intervalSec: 60 });
    checks.inside_window_unblocked = (await blocked()) === false;

    // (B) At 19:00 (after 18:00 block) reconcile -> blocked.
    const t19 = Date.parse('2026-06-22T09:00:00.000Z');
    await runDeviceSync(adapter, provider, new Date(t19).toISOString(), { intervalSec: 60 });
    checks.after_window_blocked = (await blocked()) === true;

    // (C) Manual unblock at 19:30 with override_until = next transition (next Mon 16:00).
    await adapter.rawQuery(`UPDATE app_block_state SET is_blocked = 0, override_until = ? WHERE device_id = ?`,
      { params: [new Date(Date.parse('2026-06-29T06:00:00.000Z')).toISOString(), d1] });
    await provider.setInternetAccess(mac, true);
    const t1930 = Date.parse('2026-06-22T09:30:00.000Z');
    await runDeviceSync(adapter, provider, new Date(t1930).toISOString(), { intervalSec: 60 });
    checks.override_holds = (await blocked()) === false; // policy says block, but hold wins

    // (D) Next Monday 16:30 (override expired, inside next allow window) -> unblocked + override cleared.
    const tNextMon = Date.parse('2026-06-29T06:30:00.000Z');
    await runDeviceSync(adapter, provider, new Date(tNextMon).toISOString(), { intervalSec: 60 });
    const ov = (await adapter.rawQuery(`SELECT override_until FROM app_block_state WHERE device_id = ?`, { params: [d1] }))[0]?.override_until;
    checks.override_cleared = ov == null;
    checks.next_window_unblocked = (await blocked()) === false;

    const all_ok = Object.values(checks).every(Boolean);
    return Response.json({ all_ok, checks });
  } catch (e) {
    return Response.json({ all_ok: false, error: String(e) }, { status: 500 });
  } finally {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  }
}
