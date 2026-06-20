import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';

const EXPECTED_TABLES = [
  'app_devices',
  'app_groups',
  'app_group_members',
  'app_block_state',
  'app_schedules',
  'app_user_grants',
  'app_access_requests',
  'app_domain_events',
  'app_domain_rollup_daily',
  'app_device_presence',
] as const;

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(os.tmpdir(), `netwarden_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`);

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: tmpDb,
        driver: 'better-sqlite3',
      },
    });

    // Run migrations twice — second run must be a no-op
    const firstRun = await runMigrations(adapter, { directory: MIGRATIONS_DIR });
    const secondRun = await runMigrations(adapter, { directory: MIGRATIONS_DIR });
    const idempotent_ok = secondRun.length === 0;

    // Verify all 10 tables exist
    const missing: string[] = [];
    for (const table of EXPECTED_TABLES) {
      try {
        await createCrudService(adapter, table).list((qb) => qb.limit(1));
      } catch {
        missing.push(table);
      }
    }
    const all_tables_ok = missing.length === 0;

    // Round-trip: insert then findOneBy
    const mac = 'AA:BB:CC:00:11:22';
    const devId = `dev_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await createCrudService(adapter, 'app_devices').insert({ id: devId, mac, status: 'online' });
    const found = await createCrudService(adapter, 'app_devices').findOneBy({ mac });
    const roundtrip_ok = found !== null && (found as Record<string, unknown>)['mac'] === mac;

    return Response.json({
      ok: true,
      all_tables_ok,
      missing,
      roundtrip_ok,
      idempotent_ok,
      first_run_count: firstRun.length,
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
