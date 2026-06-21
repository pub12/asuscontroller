/**
 * src/server/telemetry/runTelemetryIngest.ts
 *
 * Worker-pure telemetry ingest core. Fetches domain events from the configured
 * TelemetryProvider and writes new rows to app_domain_events, deduplicating by
 * a deterministic composite PK.
 *
 * IMPORTANT CONSTRAINTS (enforced by design):
 *  - NO `import 'server-only'` — the plain-Node worker (scripts/worker.mjs)
 *    dynamically imports this file under `node --input-type=module` with native
 *    TypeScript type-stripping. That runtime does NOT resolve `@/` aliases or
 *    `.js`→`.ts` redirects.
 *  - NO runtime value imports. Only type-only imports (erased at compile time).
 *  - Adapter contract declared inline; TelemetryProvider imported as a type only.
 *  - All DB I/O goes through adapter.rawQuery(sql, { params }).
 *  - Makes ZERO network calls directly — all I/O through adapter and provider.
 *
 * IDEMPOTENCY DESIGN:
 *  The watermark (MAX(ts) in app_domain_events) anchors window_from. The
 *  provider is queried over a half-open [from, to) window, so the exact boundary
 *  event is re-fetched on the next run. The real backstop against duplicates is
 *  the deterministic composite PK (`dom_` + mac + `_` + timestamp + `_` + domain):
 *  a PRE-SELECT existence check provides the authoritative inserted/skipped
 *  counter, and INSERT OR IGNORE is a belt-and-suspenders backstop for two events
 *  in the same batch sharing a PK. This is robust to clock-equality scenarios
 *  where window exclusivity alone is not sufficient.
 *
 * Used by:
 *  - src/app/api/ingest-test/route.ts — telemetry ingest hermetic autotest
 *  - scripts/worker.mjs               — plain-Node background telemetry worker
 */

import type { TelemetryProvider } from './TelemetryProvider';

// Adapter contract — declared inline so this file has zero runtime imports.
type IngestAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IngestSummary {
  /** Events returned by the provider for the queried window. */
  fetched: number;
  /** New rows written to app_domain_events. */
  inserted: number;
  /** Events whose composite PK already existed (deduplicated, not inserted). */
  skipped: number;
  /** Events whose MAC matched no app_devices row (not inserted, no orphan row). */
  unknown_mac: number;
  /** false when the provider is not configured (graceful no-op run). */
  configured: boolean;
  /** ISO 8601 start of the queried window. */
  window_from: string;
  /** ISO 8601 end of the queried window. */
  window_to: string;
}

/**
 * Ingest domain events from the provider into app_domain_events.
 *
 * @param adapter     hazo_connect adapter exposing rawQuery.
 * @param provider    TelemetryProvider implementation (real or fake).
 * @param nowIso      Current timestamp as an ISO-8601 string (UTC).
 * @param options.lookbackSec  Window (in seconds) used for the first-run backfill
 *                    when app_domain_events is empty (default 86400 = 24 hours).
 *                    Subsequent runs are bounded by the watermark, so this only
 *                    applies to a cold-start with no existing rows.
 */
export async function runTelemetryIngest(
  adapter: IngestAdapter,
  provider: TelemetryProvider,
  nowIso: string,
  options?: { lookbackSec?: number },
): Promise<IngestSummary> {
  // Default 24-hour cold-start backfill window.
  const lookbackSec = options?.lookbackSec ?? 86400;

  // ---------------------------------------------------------------------------
  // 1. Watermark: find the latest event already in the table.
  // ---------------------------------------------------------------------------
  const watermarkRows = await adapter.rawQuery(
    'SELECT MAX(ts) AS maxTs FROM app_domain_events',
  );
  // Read robustly: handle both aliased and literal column names returned by
  // different SQLite drivers (mirrors the robust pattern in pruneEvents.ts).
  const maxTs: string | null =
    watermarkRows[0]?.maxTs ?? watermarkRows[0]?.['MAX(ts)'] ?? null;

  // ---------------------------------------------------------------------------
  // 2. Compute the query window.
  // ---------------------------------------------------------------------------
  const window_to = nowIso;
  const window_from =
    maxTs ?? new Date(Date.parse(nowIso) - lookbackSec * 1000).toISOString();

  // No events possible if the window is zero-width or inverted (string compare
  // on ISO-8601 is lexicographically correct for UTC timestamps).
  if (window_from >= window_to) {
    return {
      fetched: 0,
      inserted: 0,
      skipped: 0,
      unknown_mac: 0,
      configured: true,
      window_from,
      window_to,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Fetch events from the provider.
  // ---------------------------------------------------------------------------
  const result = await provider.getDomainEvents({ from: window_from, to: window_to });

  // Graceful not-configured path: log nothing, do not throw.
  if (result.configured === false) {
    return {
      fetched: 0,
      inserted: 0,
      skipped: 0,
      unknown_mac: 0,
      configured: false,
      window_from,
      window_to,
    };
  }

  const events = result.events;
  const fetched = events.length;

  // ---------------------------------------------------------------------------
  // 4. Build MAC → device_id map (single query, built once for the whole batch).
  // ---------------------------------------------------------------------------
  const deviceRows = await adapter.rawQuery('SELECT id, mac FROM app_devices');
  const macMap = new Map<string, string>();
  for (const row of deviceRows) {
    if (row.mac != null) {
      macMap.set(String(row.mac).toUpperCase(), String(row.id));
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Insert each event, deduplicating by composite PK.
  // ---------------------------------------------------------------------------
  let inserted = 0;
  let skipped = 0;
  let unknown_mac = 0;

  for (const event of events) {
    // Resolve MAC → device_id; skip if no matching device (no orphan rows).
    const deviceId = macMap.get(event.deviceMac.toUpperCase());
    if (deviceId === undefined) {
      unknown_mac++;
      continue;
    }

    // Deterministic composite PK: mac + timestamp + domain.
    const id = 'dom_' + event.deviceMac + '_' + event.timestamp + '_' + event.domain;

    // PRE-SELECT existence check provides the authoritative inserted/skipped
    // counter. The hazo_connect adapter does not reliably surface mutation row
    // counts (same reason pruneEvents.ts COUNTs-then-DELETEs rather than using
    // changes()), so we check before inserting.
    const existing = await adapter.rawQuery(
      'SELECT 1 AS hit FROM app_domain_events WHERE id = ?',
      { params: [id] },
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // INSERT OR IGNORE is a belt-and-suspenders backstop in case two events in
    // the same batch share a PK (e.g. provider emits duplicate records). The
    // pre-SELECT above is the authoritative counter — if we reach here the row
    // should not exist, but OR IGNORE makes the write safe regardless.
    await adapter.rawQuery(
      'INSERT OR IGNORE INTO app_domain_events (id, device_id, domain, ts, blocked) VALUES (?, ?, ?, ?, ?)',
      { params: [id, deviceId, event.domain, event.timestamp, event.blocked ? 1 : 0] },
    );
    inserted++;
  }

  // ---------------------------------------------------------------------------
  // 6. Return summary.
  // ---------------------------------------------------------------------------
  return {
    fetched,
    inserted,
    skipped,
    unknown_mac,
    configured: true,
    window_from,
    window_to,
  };
}
