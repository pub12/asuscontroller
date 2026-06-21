/**
 * src/server/retention/pruneEvents.ts
 *
 * Retention pruning for app_domain_events raw telemetry.
 *
 * Intentionally dependency-light — no hazo imports, no 'server-only' directive —
 * so this module can be dynamically imported by scripts/worker.mjs under Node
 * with native type-stripping.
 *
 * Only app_domain_events is touched; rollup tables (app_domain_rollup_daily,
 * app_device_presence) are never modified.
 */

/**
 * Pure: compute the ISO-8601 cutoff string for a given retention window.
 * retentionDays is clamped to a minimum of 1.
 * No side effects, no Date.now().
 */
export function computeCutoff(now: Date, retentionDays: number): string {
  const clamped = Math.max(1, retentionDays);
  return new Date(now.getTime() - clamped * 86_400_000).toISOString();
}

export interface PruneResult {
  cutoff: string;
  deleted: number;
}

/**
 * Delete app_domain_events rows with ts < cutoff.
 * Rollup tables are never touched.
 *
 * adapter must expose rawQuery(sql, { params }).
 *
 * SQLite DELETE does not return a row count via rawQuery, so we COUNT first,
 * then DELETE. The count is read robustly to handle both aliased and literal
 * column names returned by different SQLite drivers.
 */
export async function pruneEvents(
  adapter: { rawQuery: (sql: string, opts?: { params?: unknown[] }) => Promise<any> },
  opts: { retentionDays: number; now?: Date },
): Promise<PruneResult> {
  const now = opts.now ?? new Date();
  const cutoff = computeCutoff(now, opts.retentionDays);

  // COUNT rows that will be deleted — handle both `n` alias and literal `COUNT(*)`.
  const countRows = await adapter.rawQuery(
    'SELECT COUNT(*) AS n FROM app_domain_events WHERE ts < ?',
    { params: [cutoff] },
  );
  const deleted: number =
    countRows[0]?.n ?? countRows[0]?.['COUNT(*)'] ?? 0;

  // Delete the stale raw events.
  await adapter.rawQuery(
    'DELETE FROM app_domain_events WHERE ts < ?',
    { params: [cutoff] },
  );

  return { cutoff, deleted };
}
