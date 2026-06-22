import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';

const EXPECTED_TABLES = [
  'hazo_app_state',
  'hazo_audit_outbox',
  'hazo_audit_field',
  'hazo_audit_intent',
] as const;

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(os.tmpdir(), `darylweb_state_audit_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`);

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: tmpDb,
        driver: 'better-sqlite3',
      },
    });

    // Run all migrations (includes 0003_hazo_state_audit.sql)
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    // Verify all 4 hazo_state + hazo_audit tables exist
    const missing: string[] = [];
    for (const table of EXPECTED_TABLES) {
      try {
        await createCrudService(adapter, table).list((qb) => qb.limit(1));
      } catch {
        missing.push(table);
      }
    }
    const all_tables_ok = missing.length === 0;

    // Round-trip: insert a row into hazo_audit_intent and read it back
    const intentId = `itest_${Date.now()}`;
    await createCrudService(adapter, 'hazo_audit_intent').insert({
      id: intentId,
      correlation_id: 'c1',
      event_name: 'test_event',
      actor_kind: 'system',
    });
    const found = await createCrudService(adapter, 'hazo_audit_intent').findOneBy({ id: intentId });
    const roundtrip_ok = found !== null && (found as Record<string, unknown>)['id'] === intentId;

    return Response.json({ ok: true, all_tables_ok, missing, roundtrip_ok });
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
