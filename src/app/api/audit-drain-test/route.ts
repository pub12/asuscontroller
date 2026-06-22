/**
 * src/app/api/audit-drain-test/route.ts
 *
 * Hermetic autotest for the full audit outbox pipeline:
 * block → outbox row → drainOnce → field rows + outbox drained.
 *
 * Runs in Next.js (react-server condition), so hazo_audit/server is safe to import.
 *
 * Lifecycle:
 * 1. Spin up a throwaway temp SQLite DB and run all migrations.
 * 2. Insert online device d1.
 * 3. Call blockDevice → writes an outbox row.
 * 4. Assert outbox has >=1 undrained row.
 * 5. startAuditWorker, drainOnce, stop → assert processed>=1, failed===0.
 * 6. Assert hazo_audit_field has >=1 row.
 * 7. Assert every outbox row now has a non-null drained_at.
 * 8. Return JSON with all assertion flags + all_ok.
 *
 * Returns 404 in production (test-only route).
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { startAuditWorker } from 'hazo_audit/server';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { blockDevice } from '@/server/devices/blockService';
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
    `darylweb_audit_drain_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
    });

    // 1. Run all migrations.
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    const nowIso = new Date().toISOString();

    // 2. Insert online device d1.
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd1',
      mac: 'AA:BB:CC:00:00:99',
      status: 'online',
      last_seen: nowIso,
    });

    // 3. Block d1 — this writes an outbox row via wrapWithAudit.
    const fake = new FakeRouterProvider();
    await blockDevice(adapter, fake, 'd1', {
      actor: { label: 'tester@example.com' },
      reason: 'drain-test',
    });

    // 4. Assert outbox has >=1 undrained row.
    const outboxBefore = await createCrudService(adapter, 'hazo_audit_outbox').list() as Record<string, unknown>[];
    const outbox_before_ok = outboxBefore.length >= 1 && outboxBefore.some((r) => r.drained_at == null);

    // 5. Start audit worker, drainOnce, stop.
    const w = startAuditWorker({ app_adapter: adapter });
    const drained = await w.drainOnce();
    await w.stop();

    const drain_ok = drained.processed >= 1 && drained.failed === 0;

    // 6. Assert hazo_audit_field has >=1 row.
    const fieldRows = await createCrudService(adapter, 'hazo_audit_field').list() as Record<string, unknown>[];
    const field_ok = fieldRows.length >= 1;

    // Note the subject_kind for reporting.
    const observed_subject_kind = fieldRows[0]?.subject_kind ?? null;

    // 7. Assert every outbox row has a non-null drained_at.
    const outboxAfter = await createCrudService(adapter, 'hazo_audit_outbox').list() as Record<string, unknown>[];
    const outbox_drained_ok = outboxAfter.length >= 1 && outboxAfter.every((r) => r.drained_at != null);

    const all_ok = outbox_before_ok && drain_ok && field_ok && outbox_drained_ok;

    return Response.json({
      ok: true,
      all_ok,
      outbox_before_ok,
      drain_ok,
      field_ok,
      outbox_drained_ok,
      observed_subject_kind,
      _drained: drained,
      _field_count: fieldRows.length,
      _outbox_after_count: outboxAfter.length,
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
