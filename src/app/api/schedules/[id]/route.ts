import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { authorizeCapability } from '@/server/permissions/authorize';
import { getJobsClientFor } from '@/server/schedules/jobsAdapter';
import {
  updateSchedule,
  setEnabled,
  cancelSchedule,
  ScheduleServiceError,
  mapScheduleErrorCode,
} from '@/server/schedules/scheduleService';

// ---------------------------------------------------------------------------
// Helper: load schedule target from DB for auth scoping
// ---------------------------------------------------------------------------

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };

async function loadScheduleTarget(
  id: string,
): Promise<{ target_type: 'device' | 'group'; target_id: string } | null> {
  const adapter = getDb() as unknown as RawAdapter;
  const rows = await adapter.rawQuery(
    'SELECT target_type, target_id FROM app_schedules WHERE id = ?',
    { params: [id] },
  );
  if (!rows || rows.length === 0) return null;
  return rows[0] as { target_type: 'device' | 'group'; target_id: string };
}

// ---------------------------------------------------------------------------
// PATCH /api/schedules/[id]
// ---------------------------------------------------------------------------

const PatchBody = z.object({
  cron: z.string().min(1).optional(),
  action: z.enum(['block', 'unblock']).optional(),
  run_at: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  label: z.string().optional(),
});

export const PATCH = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return fail('VALIDATION_FAILED', 'Invalid JSON body');
    }

    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; '));
    }

    const row = await loadScheduleTarget(id);
    if (!row) return fail('NOT_FOUND', 'Schedule not found');

    const target =
      row.target_type === 'device'
        ? { deviceId: row.target_id }
        : { scopeType: 'group' as const, scopeId: row.target_id };

    const adapter = getDb();
    const decision = await authorizeCapability(
      adapter,
      { subject: auth.subject, isSuperadmin: auth.isSuperadmin },
      'schedule.cancel',
      target,
    );
    if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

    const jobs = await getJobsClientFor(adapter);
    const body = parsed.data;

    try {
      let schedule;

      // If enabled is present, call setEnabled first.
      if (body.enabled !== undefined) {
        schedule = await setEnabled({ adapter, jobs, id, enabled: body.enabled });
      }

      // If there are other patch fields, call updateSchedule.
      const { enabled: _enabled, ...rest } = body;
      const hasPatch = Object.keys(rest).length > 0;
      if (hasPatch) {
        schedule = await updateSchedule({ adapter, jobs, id, patch: rest });
      }

      // If nothing was patched (only enabled was present or nothing at all)
      if (!schedule) {
        // Return current row unchanged
        schedule = await updateSchedule({ adapter, jobs, id, patch: {} });
      }

      return ok({ schedule });
    } catch (err) {
      if (err instanceof ScheduleServiceError) {
        return fail(mapScheduleErrorCode(err.code), err.message);
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/schedules/[id]
// ---------------------------------------------------------------------------

export const DELETE = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;

    const row = await loadScheduleTarget(id);
    if (!row) return fail('NOT_FOUND', 'Schedule not found');

    const target =
      row.target_type === 'device'
        ? { deviceId: row.target_id }
        : { scopeType: 'group' as const, scopeId: row.target_id };

    const adapter = getDb();
    const decision = await authorizeCapability(
      adapter,
      { subject: auth.subject, isSuperadmin: auth.isSuperadmin },
      'schedule.cancel',
      target,
    );
    if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

    const jobs = await getJobsClientFor(adapter);

    try {
      const schedule = await cancelSchedule({ adapter, jobs, id });
      return ok({ schedule });
    } catch (err) {
      if (err instanceof ScheduleServiceError) {
        return fail(mapScheduleErrorCode(err.code), err.message);
      }
      throw err;
    }
  },
);
