import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { runDeviceSync } from '@/server/sync/runDeviceSync';
import { getSyncIntervalSec } from '@/lib/env';

// Local alias matching the SyncAdapter contract declared in runDeviceSync.
// (See the note in ../run/route.ts — SQLite accepts { params } at runtime.)
type SyncAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

/**
 * Manual "Refresh" — runs a full device sync AND pulls live block state from the
 * router (blockReconcile: 'pull'). Unlike the background worker (which re-applies
 * the app's intended block state), this mirrors the router's actual state into the
 * app, so a block/unblock done directly on the router is reflected here — e.g. a
 * stale "Blocked" badge clears.
 */
export const POST = withRequestContext(async () => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  const provider = await getRouterProvider();
  const summary = await runDeviceSync(
    getDb() as unknown as SyncAdapter,
    provider,
    new Date().toISOString(),
    { intervalSec: getSyncIntervalSec(), blockReconcile: 'pull' },
  );

  return ok({ summary });
});
