/**
 * src/server/schedules/jobsAdapter.ts
 *
 * Builds a hazo_jobs JobsClient from a hazo_connect adapter.
 *
 * hazo_connect's rawQuery(sql, { params }) and hazo_jobs's raw(sql, values[])
 * have slightly different calling conventions — this module bridges them:
 *
 *  1. Translates $N placeholders → ? (SQLite uses positional `?`; hazo_jobs
 *     emits $1/$2 style on PG path but ? on SQLite — the translation is a
 *     safety net so both forms work).
 *  2. Coerces booleans → 1/0 and undefined → null for SQLite compatibility.
 *
 * applyDdl is called on every getJobsClientFor() call — it is idempotent
 * (CREATE TABLE IF NOT EXISTS) so calling it multiple times is safe.
 */
import 'server-only';
import { createJobsClient, applyDdl } from 'hazo_jobs/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import type { JobsClient } from 'hazo_jobs/server';

// Re-export JobsClient type for convenience (used in blockService / blockActions opts).
export type { JobsClient };

// ---------------------------------------------------------------------------
// Internal: build a hazo_jobs RawAdapter wrapping a hazo_connect adapter.
// ---------------------------------------------------------------------------
function buildRawAdapter(hcAdapter: HazoConnectAdapter) {
  return {
    raw(sql: string, values: unknown[] = []): Promise<any[]> {
      // Translate $N → ? (safety net for PG-style placeholders).
      const translated = sql.replace(/\$(\d+)/g, '?');
      // Coerce booleans → 1/0, undefined → null.
      const params = values.map((v) => {
        if (v === undefined) return null;
        if (v === true) return 1;
        if (v === false) return 0;
        return v;
      });
      // Cast: HazoConnectAdapter's base type uses RequestInit but the SQLite
      // adapter (which this app uses) accepts { params }. Mirror pattern from
      // runDeviceSync.ts which uses an inline adapter type.
      return (hcAdapter as unknown as { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> })
        .rawQuery(translated, { params });
    },
  };
}

// ---------------------------------------------------------------------------
// Public: getJobsClientFor
//
// Given a hazo_connect adapter, initialise the hazo_jobs DDL (idempotent)
// and return a fully-configured JobsClient.
//
// The DDL path is resolved relative to node_modules so this works regardless
// of where process.cwd() is (Next.js may run from project root or .next/).
// ---------------------------------------------------------------------------
export async function getJobsClientFor(hcAdapter: HazoConnectAdapter): Promise<JobsClient> {
  const rawAdapter = buildRawAdapter(hcAdapter);

  // Resolve DDL path: walk up from this file's location to repo root.
  // __dirname is not available in ESM, so use import.meta when available;
  // fall back to process.cwd() which Next.js always sets to the project root.
  const repoRoot = process.cwd();
  const ddlPath = path.join(repoRoot, 'node_modules', 'hazo_jobs', 'db_setup_sqlite.sql');
  const ddl = readFileSync(ddlPath, 'utf8');
  await applyDdl(rawAdapter, ddl);

  return createJobsClient({
    connect: { adapter: rawAdapter },
    dialect: 'sqlite',
  });
}
