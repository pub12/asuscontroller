import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runDeviceSync } from '@/server/sync/runDeviceSync';

// Local alias matching the SyncAdapter contract declared in runDeviceSync.
// The hazo_connect HazoConnectAdapter types rawQuery with RequestInit options
// (for PostgREST), but the SQLite driver accepts { params } at runtime.
// We cast through `unknown` to reconcile the two signatures.
type SyncAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_sync_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const rawAdapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: tmpDb,
        driver: 'better-sqlite3',
      },
    });
    // Cast: the SQLite driver honours { params } at runtime; the generic
    // HazoConnectAdapter type reflects the PostgREST-oriented overload.
    const adapter = rawAdapter as unknown as SyncAdapter;

    await runMigrations(rawAdapter, { directory: MIGRATIONS_DIR });

    const provider = new FakeRouterProvider(); // 10 online devices

    // --- Round 1: initial insert ---
    const t0 = '2026-06-20T10:00:00.000Z';
    const s1 = await runDeviceSync(adapter, provider, t0, { intervalSec: 60 });
    const first_insert_ok = s1.inserted === 10 && s1.updated === 0;

    // Verify is_new and first_seen on one device.
    const sampleRows = await adapter.rawQuery(
      `SELECT is_new, first_seen FROM app_devices LIMIT 1`,
    ) as { is_new: number; first_seen: string }[];
    const sample = sampleRows[0];
    const is_new_ok = sample?.is_new === 1;
    const first_seen_ok = sample?.first_seen === t0;

    // --- Round 2: update + presence accrual (60 s later) ---
    const t1 = '2026-06-20T10:01:00.000Z';
    const s2 = await runDeviceSync(adapter, provider, t1, { intervalSec: 60 });
    const update_ok = s2.updated === 10 && s2.inserted === 0;

    // Verify presence row for the same device.
    const presRows = await adapter.rawQuery(
      `SELECT connected_minutes FROM app_device_presence
       WHERE day = '2026-06-20'
       LIMIT 1`,
    ) as { connected_minutes: number }[];
    const presMinutes = presRows[0]?.connected_minutes ?? 0;
    const presence_accrual_ok =
      s2.presence_minutes_added === 10 && presMinutes >= 1;

    // --- Mutate provider ---
    const allClients = await provider.getClientList();
    const m0 = allClients[0].mac;

    provider.goOffline(m0);
    provider.addDevice({
      mac: 'AA:BB:CC:DD:EE:01',
      ip: '192.168.50.201',
      name: 'New-Laptop',
      connected: true,
      band: '5G',
      vendor: 'TestCorp',
    });

    // --- Round 3: offline + new device ---
    const t2 = '2026-06-20T10:02:00.000Z';
    const s3 = await runDeviceSync(adapter, provider, t2, { intervalSec: 60 });

    const offlineRows = await adapter.rawQuery(
      `SELECT status FROM app_devices WHERE mac = ?`,
      { params: [m0] },
    ) as { status: string }[];
    const offline_ok =
      s3.went_offline === 1 && offlineRows[0]?.status === 'offline';

    const newDevRows = await adapter.rawQuery(
      `SELECT is_new FROM app_devices WHERE mac = 'AA:BB:CC:DD:EE:01'`,
    ) as { is_new: number }[];
    const new_insert_ok = s3.inserted === 1 && newDevRows[0]?.is_new === 1;

    return Response.json({
      ok: true,
      first_insert_ok,
      is_new_ok,
      first_seen_ok,
      update_ok,
      presence_accrual_ok,
      offline_ok,
      new_insert_ok,
      _ok: true,
      summaries: { s1, s2, s3 },
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
