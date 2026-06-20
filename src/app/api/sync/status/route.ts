import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';

// hazo_jobs table name: hazo_jobs
// Relevant columns: type, status, result, completed_at, submitted_at
// We use completed_at as last_run_at (falls back to submitted_at if null)

export const GET = withRequestContext(async () => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  try {
    const rows = await getDb().rawQuery(
      `SELECT status, result, completed_at, submitted_at
       FROM hazo_jobs
       WHERE type = 'netwarden.sync'
       ORDER BY submitted_at DESC
       LIMIT 1`,
    ) as { status: string; result: string | null; completed_at: string | null; submitted_at: string }[];

    if (!rows || rows.length === 0) {
      return ok({ last_run_at: null, status: null, summary: null });
    }

    const row = rows[0];
    const last_run_at = row.completed_at ?? row.submitted_at ?? null;

    let summary: unknown = null;
    if (row.result) {
      try {
        summary = JSON.parse(row.result);
      } catch {
        summary = null;
      }
    }

    return ok({ last_run_at, status: row.status, summary });
  } catch {
    // hazo_jobs table may not exist yet (worker never ran)
    return ok({ last_run_at: null, status: null, summary: null });
  }
});
