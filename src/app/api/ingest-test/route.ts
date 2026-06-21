import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runDeviceSync } from '@/server/sync/runDeviceSync';
import { FakeTelemetryProvider } from '@/server/telemetry/FakeTelemetryProvider';
import { runTelemetryIngest } from '@/server/telemetry/runTelemetryIngest';
import type { TelemetryProvider } from '@/server/telemetry/TelemetryProvider';

// Local alias matching the IngestAdapter contract declared in runTelemetryIngest.
// The hazo_connect HazoConnectAdapter types rawQuery with RequestInit options
// (for PostgREST), but the SQLite driver accepts { params } at runtime.
// We cast through `unknown` to reconcile the two signatures.
type IngestAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

async function countEvents(a: IngestAdapter): Promise<number> {
  const rows = await a.rawQuery('SELECT COUNT(*) AS n FROM app_domain_events');
  return rows[0]?.n ?? rows[0]?.['COUNT(*)'] ?? 0;
}

export async function GET() {
  // Self-contained autotest endpoint — runs unauthenticated server work against
  // a throwaway DB so the /autotest harness can reach it in dev/CI. It must NOT
  // be reachable in production: return 404 there (route appears not to exist).
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_ingest_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
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
    const adapter = rawAdapter as unknown as IngestAdapter;

    await runMigrations(rawAdapter, { directory: MIGRATIONS_DIR });

    // 1. Seed 10 device rows so MAC->device_id resolves.
    await runDeviceSync(adapter as any, new FakeRouterProvider(), '2026-06-21T01:00:00.000Z', { intervalSec: 60 });

    // 2. Telemetry provider with the 39-event default seed; inject one UNKNOWN-MAC event in-window.
    const tele = new FakeTelemetryProvider();
    tele.addDomainEvent({ deviceMac: 'FF:FF:FF:FF:FF:FF', domain: 'unknown-device.example', timestamp: '2026-06-21T00:20:00.000Z', blocked: false });

    const nowIso = '2026-06-21T02:00:00.000Z';

    // 3. First ingest (cold table → 24h backfill window covers all seed events).
    const s1 = await runTelemetryIngest(adapter, tele, nowIso);
    const count1 = await countEvents(adapter);

    // 4. Re-ingest (watermark now at the last event → only the boundary event re-fetched, deduped).
    const s2 = await runTelemetryIngest(adapter, tele, nowIso);
    const count2 = await countEvents(adapter);

    // 5. Not-configured provider → graceful no-op (inline stub; no server-only import).
    const ncProvider = {
      isConfigured: async () => false,
      getDomainEvents: async () => ({ configured: false, reason: 'test: not configured' }),
      getDailyRollup: async () => ({ configured: false, reason: 'test' }),
      getDevicePresence: async () => ({ configured: false, reason: 'test' }),
    } as unknown as TelemetryProvider;
    const sNc = await runTelemetryIngest(adapter, ncProvider, nowIso);
    const count3 = await countEvents(adapter);

    // 6. Column-level checks.
    const blockedRows = await adapter.rawQuery('SELECT COUNT(*) AS n FROM app_domain_events WHERE blocked = 1');
    const blockedCount = blockedRows[0]?.n ?? blockedRows[0]?.['COUNT(*)'] ?? 0;
    const unknownRows = await adapter.rawQuery("SELECT COUNT(*) AS n FROM app_domain_events WHERE domain = 'unknown-device.example'");
    const unknownDomainCount = unknownRows[0]?.n ?? unknownRows[0]?.['COUNT(*)'] ?? 0;

    const initial_insert_ok = s1.configured === true && s1.inserted === 39 && s1.skipped === 0 && count1 === 39;
    const fetched_ok = s1.fetched === 40; // 39 seed + 1 unknown-mac event
    const unknown_mac_ok = s1.unknown_mac === 1 && unknownDomainCount === 0; // counted, but no orphan row written
    const reingest_dedupe_ok = s2.inserted === 0 && s2.skipped >= 1 && count2 === 39; // idempotent: composite-PK dedupe, total unchanged
    const blocked_persisted_ok = blockedCount === 4;
    const not_configured_ok = sNc.configured === false && sNc.fetched === 0 && sNc.inserted === 0 && count3 === 39;
    const all_ok = initial_insert_ok && fetched_ok && unknown_mac_ok && reingest_dedupe_ok && blocked_persisted_ok && not_configured_ok;

    return Response.json({
      ok: true,
      initial_insert_ok,
      fetched_ok,
      unknown_mac_ok,
      reingest_dedupe_ok,
      blocked_persisted_ok,
      not_configured_ok,
      all_ok,
      summaries: { s1, s2, sNc, count1, count2, count3, blockedCount, unknownDomainCount },
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
