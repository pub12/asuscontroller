import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { runDeviceSync } from '@/server/sync/runDeviceSync';
import { getSyncIntervalSec } from '@/lib/env';

// Local alias matching the SyncAdapter contract declared in runDeviceSync.
// The hazo_connect HazoConnectAdapter types rawQuery with RequestInit options
// (for PostgREST), but the SQLite driver accepts { params } at runtime.
// We cast through `unknown` to reconcile the two signatures.
type SyncAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

export const POST = withRequestContext(async () => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

  const provider = await getRouterProvider();
  const summary = await runDeviceSync(
    getDb() as unknown as SyncAdapter,
    provider,
    new Date().toISOString(),
    { intervalSec: getSyncIntervalSec() },
  );

  return ok({ summary });
});
