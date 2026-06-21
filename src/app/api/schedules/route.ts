import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { authorizeCapability } from '@/server/permissions/authorize';
import { getJobsClientFor } from '@/server/schedules/jobsAdapter';
import {
  listSchedules,
  createTimer,
  createFutureBlock,
  createRecurring,
  createWindow,
  ScheduleServiceError,
} from '@/server/schedules/scheduleService';

// ---------------------------------------------------------------------------
// GET /api/schedules
// ---------------------------------------------------------------------------

export const GET = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  const url = new URL(req.url);
  const targetType = url.searchParams.get('targetType') as 'device' | 'group' | null;
  const targetId = url.searchParams.get('targetId') ?? undefined;

  const adapter = getDb();
  const jobs = await getJobsClientFor(adapter);

  const schedules = await listSchedules({
    adapter,
    jobs,
    targetType: targetType ?? undefined,
    targetId,
  });

  return ok(schedules);
});

// ---------------------------------------------------------------------------
// POST /api/schedules
// ---------------------------------------------------------------------------

const TargetTypeEnum = z.enum(['device', 'group']);
const ActionEnum = z.enum(['block', 'unblock']);
// Basic 5-field cron: allow standard 5-field expressions
const CronField = z.string().min(1).regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, 'cron must be a 5-field expression');

const TimerBody = z.object({
  kind: z.literal('timer'),
  targetType: TargetTypeEnum,
  targetId: z.string().min(1),
  durationMin: z.number().positive().optional(),
  untilISO: z.string().min(1).optional(),
  label: z.string().optional(),
});

const FutureBody = z.object({
  kind: z.literal('future'),
  targetType: TargetTypeEnum,
  targetId: z.string().min(1),
  action: ActionEnum,
  atISO: z.string().min(1),
  label: z.string().optional(),
});

const RecurringBody = z.object({
  kind: z.literal('recurring'),
  targetType: TargetTypeEnum,
  targetId: z.string().min(1),
  action: ActionEnum,
  cron: CronField,
  label: z.string().optional(),
});

const WindowBody = z.object({
  kind: z.literal('window'),
  targetType: TargetTypeEnum,
  targetId: z.string().min(1),
  blockCron: CronField,
  unblockCron: CronField,
  label: z.string().optional(),
});

const CreateBody = z.discriminatedUnion('kind', [
  TimerBody,
  FutureBody,
  RecurringBody,
  WindowBody,
]);

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail('VALIDATION_FAILED', 'Invalid JSON body');
  }

  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const body = parsed.data;
  const { targetType, targetId } = body;

  const target =
    targetType === 'device'
      ? { deviceId: targetId }
      : { scopeType: 'group' as const, scopeId: targetId };

  const adapter = getDb();
  const decision = await authorizeCapability(
    adapter,
    { subject: auth.subject, isSuperadmin: auth.isSuperadmin },
    'schedule.create',
    target,
  );
  if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

  const jobs = await getJobsClientFor(adapter);
  const provider = await getRouterProvider();
  const actor = { userId: auth.subject, label: auth.subject ?? 'unknown' };

  // Map ScheduleServiceError codes → hazo_api fail codes
  const mapCode = (code: string): 'NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR' =>
    code === 'JOBS_ERROR' ? 'INTERNAL_ERROR' : (code as 'NOT_FOUND' | 'VALIDATION_FAILED');

  try {
    if (body.kind === 'timer') {
      const schedule = await createTimer({
        adapter, jobs, provider,
        targetType, targetId,
        durationMin: body.durationMin,
        untilISO: body.untilISO,
        label: body.label,
        actor,
      });
      return ok({ schedule });
    }

    if (body.kind === 'future') {
      const schedule = await createFutureBlock({
        adapter, jobs,
        targetType, targetId,
        action: body.action,
        atISO: body.atISO,
        label: body.label,
        actor,
      });
      return ok({ schedule });
    }

    if (body.kind === 'recurring') {
      const schedule = await createRecurring({
        adapter, jobs,
        targetType, targetId,
        action: body.action,
        cron: body.cron,
        label: body.label,
        actor,
      });
      return ok({ schedule });
    }

    // kind === 'window'
    const result = await createWindow({
      adapter, jobs,
      targetType, targetId,
      blockCron: body.blockCron,
      unblockCron: body.unblockCron,
      label: body.label,
      actor,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof ScheduleServiceError) {
      return fail(mapCode(err.code), err.message);
    }
    throw err;
  }
});
