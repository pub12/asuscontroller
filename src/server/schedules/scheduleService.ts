/**
 * src/server/schedules/scheduleService.ts
 *
 * Server-only schedule management service. Creates, cancels, and lists
 * app_schedules rows, submitting/cancelling corresponding hazo_jobs entries.
 *
 * All functions accept an adapter (hazo_connect) + a jobs client (from
 * getJobsClientFor) + where needed a RouterProvider + an actor descriptor.
 *
 * Error convention: throws ScheduleServiceError with a typed code, mirroring
 * BlockServiceError. Callers wanting outcome types can wrap in try/catch.
 */
import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import { createCrudService } from 'hazo_connect/server';
import type { RouterProvider } from '../router/RouterProvider';
import { runBlockAction } from '../devices/blockActions';
import { runGroupBlockAction } from '../groups/groupBlockActions';
import type { JobsClient } from './jobsAdapter';
import { durationToISO } from './tz';

// HazoConnectAdapter's base rawQuery type uses RequestInit (PostgREST signature),
// but the SQLite adapter (used in this app) accepts { params?: unknown[] }.
// Cast through this type for direct SQL calls — mirrors runDeviceSync.ts pattern.
type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };
const raw = (adapter: HazoConnectAdapter): RawAdapter =>
  adapter as unknown as RawAdapter;

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export type ScheduleServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'JOBS_ERROR';

export class ScheduleServiceError extends Error {
  code: ScheduleServiceErrorCode;
  constructor(code: ScheduleServiceErrorCode, message: string) {
    super(message);
    this.name = 'ScheduleServiceError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleActor {
  userId?: string | null;
  label: string;
}

export interface ScheduleRow extends Record<string, unknown> {
  id: string;
  target_type: 'device' | 'group';
  target_id: string;
  action: 'block' | 'unblock';
  run_at: string | null;
  cron: string | null;
  job_id: string;
  status: 'active' | 'paused' | 'done' | 'cancelled';
  created_by: string | null;
  created_at: string;
  label: string | null;
  window_id: string | null;
}

interface ScheduleJobPayload {
  targetType: 'device' | 'group';
  targetId: string;
  action: 'block' | 'unblock';
  scheduleId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function schedId(): string {
  return 'sch_' + crypto.randomUUID();
}

function winId(): string {
  return 'win_' + crypto.randomUUID();
}

const scheduleSvc = (adapter: HazoConnectAdapter) =>
  createCrudService<ScheduleRow>(adapter, 'app_schedules', { autoId: false });

async function loadRow(adapter: HazoConnectAdapter, id: string): Promise<ScheduleRow> {
  const row = await scheduleSvc(adapter).findById(id);
  if (!row) throw new ScheduleServiceError('NOT_FOUND', `Schedule ${id} not found`);
  return row as ScheduleRow;
}

async function assertNoActiveOneShot(
  adapter: HazoConnectAdapter,
  targetType: 'device' | 'group',
  targetId: string,
): Promise<void> {
  const existing = await raw(adapter).rawQuery(
    `SELECT id FROM app_schedules
       WHERE target_type = ? AND target_id = ? AND cron IS NULL AND status = 'active'
       LIMIT 1`,
    { params: [targetType, targetId] },
  );
  if (existing.length > 0) {
    throw new ScheduleServiceError('VALIDATION_FAILED', 'A timer is already active for this target');
  }
}

// ---------------------------------------------------------------------------
// createTimer
//
// Block a device/group NOW, then schedule an automatic unblock at runAt.
// Either durationMin (e.g. 30) or untilISO (explicit future ISO) is required.
// ---------------------------------------------------------------------------

export async function createTimer(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  provider: RouterProvider;
  targetType: 'device' | 'group';
  targetId: string;
  durationMin?: number;
  untilISO?: string;
  label?: string;
  actor: ScheduleActor;
}): Promise<ScheduleRow> {
  const { adapter, jobs, provider, targetType, targetId, label, actor } = opts;

  if (opts.durationMin == null && opts.untilISO == null) {
    throw new ScheduleServiceError('VALIDATION_FAILED', 'Either durationMin or untilISO is required for a timer');
  }

  const runAt = opts.durationMin != null
    ? durationToISO(opts.durationMin)
    : opts.untilISO!;

  await assertNoActiveOneShot(adapter, targetType, targetId);

  // Block immediately.
  const gate = { authorized: true, actorLabel: actor.label, actorUserId: actor.userId ?? null };
  if (targetType === 'device') {
    const outcome = await runBlockAction(adapter, provider, gate, targetId, 'block');
    if (outcome.ok === false) {
      throw new ScheduleServiceError(
        outcome.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
        outcome.message,
      );
    }
  } else {
    const outcome = await runGroupBlockAction(adapter, provider, gate, targetId, 'block');
    if (outcome.ok === false) {
      throw new ScheduleServiceError('NOT_FOUND', outcome.message);
    }
  }

  const scheduleId = schedId();
  const payload: ScheduleJobPayload = { targetType, targetId, action: 'unblock', scheduleId };

  let jobId: string | undefined;
  try {
    const submitted = await jobs.submit({
      type: 'netwarden.unblock',
      description: 'scheduled unblock ' + targetId,
      payload,
      runAt,
      maxAttempts: 1,
    });
    jobId = submitted.jobId;

    // For device targets: stamp the scheduled unblock info into app_block_state.
    if (targetType === 'device') {
      await raw(adapter).rawQuery(
        `UPDATE app_block_state
            SET scheduled_unblock_at = ?, unblock_job_id = ?
          WHERE device_id = ?`,
        { params: [runAt, jobId, targetId] },
      );
    }

    const now = new Date().toISOString();
    const row: ScheduleRow = {
      id: scheduleId,
      target_type: targetType,
      target_id: targetId,
      action: 'unblock',
      run_at: runAt,
      cron: null,
      job_id: jobId,
      status: 'active',
      created_by: actor.userId ?? null,
      created_at: now,
      label: label ?? null,
      window_id: null,
    };

    await scheduleSvc(adapter).insert(row);
    return row;
  } catch (e) {
    // Best-effort compensation: cancel the job (if created) then revert the immediate block.
    if (jobId != null) {
      await jobs.cancel(jobId).catch(() => {});
    }
    if (targetType === 'device') {
      await runBlockAction(adapter, provider, gate, targetId, 'unblock').catch(() => {});
    } else {
      await runGroupBlockAction(adapter, provider, gate, targetId, 'unblock').catch(() => {});
    }
    throw new ScheduleServiceError('JOBS_ERROR', `Failed to create timer: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// createUnblockTimer
//
// The mirror of createTimer: UNBLOCK a device/group NOW, then schedule an
// automatic RE-BLOCK at runAt (a temporary reprieve — "unblock the laptop for
// 1 hour"). Either durationMin or untilISO is required.
// ---------------------------------------------------------------------------

export async function createUnblockTimer(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  provider: RouterProvider;
  targetType: 'device' | 'group';
  targetId: string;
  durationMin?: number;
  untilISO?: string;
  label?: string;
  actor: ScheduleActor;
}): Promise<ScheduleRow> {
  const { adapter, jobs, provider, targetType, targetId, label, actor } = opts;

  if (opts.durationMin == null && opts.untilISO == null) {
    throw new ScheduleServiceError('VALIDATION_FAILED', 'Either durationMin or untilISO is required for an unblock timer');
  }

  const runAt = opts.durationMin != null
    ? durationToISO(opts.durationMin)
    : opts.untilISO!;

  await assertNoActiveOneShot(adapter, targetType, targetId);

  // Unblock immediately.
  const gate = { authorized: true, actorLabel: actor.label, actorUserId: actor.userId ?? null };
  if (targetType === 'device') {
    const outcome = await runBlockAction(adapter, provider, gate, targetId, 'unblock');
    if (outcome.ok === false) {
      throw new ScheduleServiceError(
        outcome.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
        outcome.message,
      );
    }
  } else {
    const outcome = await runGroupBlockAction(adapter, provider, gate, targetId, 'unblock');
    if (outcome.ok === false) {
      throw new ScheduleServiceError('NOT_FOUND', outcome.message);
    }
  }

  const scheduleId = schedId();
  const payload: ScheduleJobPayload = { targetType, targetId, action: 'block', scheduleId };

  let jobId: string | undefined;
  try {
    const submitted = await jobs.submit({
      type: 'netwarden.block',
      description: 'scheduled re-block ' + targetId,
      payload,
      runAt,
      maxAttempts: 1,
    });
    jobId = submitted.jobId;

    const now = new Date().toISOString();
    const row: ScheduleRow = {
      id: scheduleId,
      target_type: targetType,
      target_id: targetId,
      action: 'block',
      run_at: runAt,
      cron: null,
      job_id: jobId,
      status: 'active',
      created_by: actor.userId ?? null,
      created_at: now,
      label: label ?? null,
      window_id: null,
    };

    await scheduleSvc(adapter).insert(row);
    return row;
  } catch (e) {
    // Best-effort compensation: cancel the job (if created) then revert the immediate unblock.
    if (jobId != null) {
      await jobs.cancel(jobId).catch(() => {});
    }
    if (targetType === 'device') {
      await runBlockAction(adapter, provider, gate, targetId, 'block').catch(() => {});
    } else {
      await runGroupBlockAction(adapter, provider, gate, targetId, 'block').catch(() => {});
    }
    throw new ScheduleServiceError('JOBS_ERROR', `Failed to create re-block timer: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// createFutureBlock
//
// Schedule a block or unblock at a future ISO instant (no immediate action).
// ---------------------------------------------------------------------------

export async function createFutureBlock(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  targetType: 'device' | 'group';
  targetId: string;
  action: 'block' | 'unblock';
  atISO: string;
  label?: string;
  actor: ScheduleActor;
}): Promise<ScheduleRow> {
  const { adapter, jobs, targetType, targetId, action, atISO, label, actor } = opts;

  const scheduleId = schedId();
  const payload: ScheduleJobPayload = { targetType, targetId, action, scheduleId };

  const { jobId } = await jobs.submit({
    type: 'netwarden.' + action,
    description: `scheduled ${action} ${targetId}`,
    payload,
    runAt: atISO,
    maxAttempts: 1,
  });

  const now = new Date().toISOString();
  const row: ScheduleRow = {
    id: scheduleId,
    target_type: targetType,
    target_id: targetId,
    action,
    run_at: atISO,
    cron: null,
    job_id: jobId,
    status: 'active',
    created_by: actor.userId ?? null,
    created_at: now,
    label: label ?? null,
    window_id: null,
  };

  await scheduleSvc(adapter).insert(row);
  return row;
}

// ---------------------------------------------------------------------------
// createRecurring
//
// Schedule a recurring block or unblock via a cron expression.
// ---------------------------------------------------------------------------

export async function createRecurring(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  targetType: 'device' | 'group';
  targetId: string;
  action: 'block' | 'unblock';
  cron: string;
  label?: string;
  windowId?: string;
  actor: ScheduleActor;
}): Promise<ScheduleRow> {
  const { adapter, jobs, targetType, targetId, action, cron, label, windowId, actor } = opts;

  // Generate scheduleId BEFORE the jobs call so payload carries it.
  const scheduleId = schedId();
  const payload: ScheduleJobPayload = { targetType, targetId, action, scheduleId };

  const schedule = await jobs.schedules.create({
    name: label ?? ('sch ' + targetId),
    cron,
    type: 'netwarden.' + action,
    payload,
    maxAttempts: 1,
  });

  const now = new Date().toISOString();
  const row: ScheduleRow = {
    id: scheduleId,
    target_type: targetType,
    target_id: targetId,
    action,
    run_at: null,
    cron,
    job_id: schedule.id,
    status: 'active',
    created_by: actor.userId ?? null,
    created_at: now,
    label: label ?? null,
    window_id: windowId ?? null,
  };

  await scheduleSvc(adapter).insert(row);
  return row;
}

// ---------------------------------------------------------------------------
// createWindow
//
// Create a block+unblock recurring pair sharing a window_id.
// ---------------------------------------------------------------------------

export async function createWindow(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  targetType: 'device' | 'group';
  targetId: string;
  blockCron: string;
  unblockCron: string;
  label?: string;
  actor: ScheduleActor;
}): Promise<{ blockRow: ScheduleRow; unblockRow: ScheduleRow }> {
  const { adapter, jobs, targetType, targetId, blockCron, unblockCron, label, actor } = opts;
  const windowId = winId();

  const blockRow = await createRecurring({
    adapter, jobs, targetType, targetId,
    action: 'block', cron: blockCron,
    label: label ? label + ' (block)' : undefined,
    windowId, actor,
  });

  const unblockRow = await createRecurring({
    adapter, jobs, targetType, targetId,
    action: 'unblock', cron: unblockCron,
    label: label ? label + ' (unblock)' : undefined,
    windowId, actor,
  });

  return { blockRow, unblockRow };
}

// ---------------------------------------------------------------------------
// updateSchedule
//
// Patch a schedule: cron / action / run_at / label / status.
// For recurring schedules: forwards cron/enabled/payload to jobs.schedules.update.
// For one-shot: if run_at changes, cancel old job and re-submit.
// ---------------------------------------------------------------------------

export async function updateSchedule(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  id: string;
  patch: Partial<Pick<ScheduleRow, 'cron' | 'action' | 'run_at' | 'label' | 'status'>>;
}): Promise<ScheduleRow> {
  const { adapter, jobs, id, patch } = opts;
  const row = await loadRow(adapter, id);

  let newJobId = row.job_id;

  if (row.cron != null) {
    // Recurring — forward to jobs.schedules.update.
    const jobPatch: Record<string, unknown> = {};
    if (patch.cron != null) jobPatch.cron = patch.cron;
    if (patch.status === 'active') jobPatch.enabled = true;
    if (patch.status === 'paused') jobPatch.enabled = false;
    if (Object.keys(jobPatch).length > 0) {
      await jobs.schedules.update(row.job_id, jobPatch);
    }
  } else {
    // One-shot — if run_at is changing, cancel old job and re-submit.
    if (patch.run_at != null && patch.run_at !== row.run_at) {
      await jobs.cancel(row.job_id); // tolerate { cancelled: false }
      const action = (patch.action ?? row.action) as 'block' | 'unblock';
      const { jobId } = await jobs.submit({
        type: 'netwarden.' + action,
        description: `scheduled ${action} ${row.target_id}`,
        payload: {
          targetType: row.target_type,
          targetId: row.target_id,
          action,
          scheduleId: id,
        },
        runAt: patch.run_at,
        maxAttempts: 1,
      });
      newJobId = jobId;
    }
  }

  // Build DB patch.
  const dbPatch: Partial<ScheduleRow> = {};
  if (patch.cron != null) dbPatch.cron = patch.cron;
  if (patch.action != null) dbPatch.action = patch.action;
  if (patch.run_at != null) dbPatch.run_at = patch.run_at;
  if (patch.label != null) dbPatch.label = patch.label;
  if (patch.status != null) dbPatch.status = patch.status;
  if (newJobId !== row.job_id) dbPatch.job_id = newJobId;

  if (Object.keys(dbPatch).length > 0) {
    await scheduleSvc(adapter).updateById(id, dbPatch);
  }

  return loadRow(adapter, id);
}

// ---------------------------------------------------------------------------
// setEnabled
//
// Enable or pause a schedule.
// ---------------------------------------------------------------------------

export async function setEnabled(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  id: string;
  enabled: boolean;
}): Promise<ScheduleRow> {
  const { adapter, jobs, id, enabled } = opts;
  const row = await loadRow(adapter, id);

  if (row.cron != null) {
    // Recurring — tell the jobs scheduler.
    await jobs.schedules.update(row.job_id, { enabled });
  }
  // One-shot: just toggle row status (there is no jobs API for scheduled-job enable/disable).
  const newStatus = enabled ? 'active' : 'paused';
  await scheduleSvc(adapter).updateById(id, { status: newStatus });
  return loadRow(adapter, id);
}

// ---------------------------------------------------------------------------
// cancelSchedule
//
// Cancel a schedule, cancelling the underlying hazo_job / hazo_schedule too.
// For active device timers: clears scheduled_unblock_at + unblock_job_id.
// ---------------------------------------------------------------------------

export async function cancelSchedule(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  id: string;
}): Promise<ScheduleRow> {
  const { adapter, jobs, id } = opts;
  const row = await loadRow(adapter, id);

  if (row.cron != null) {
    // Recurring: delete the jobs schedule (idempotent; ignores not-found).
    await jobs.schedules.delete(row.job_id).catch(() => {});
  } else {
    // One-shot: cancel the pending job (tolerate cancelled: false).
    await jobs.cancel(row.job_id).catch(() => {});
  }

  await scheduleSvc(adapter).updateById(id, { status: 'cancelled' });

  // If this was a device timer (unblock + run_at set), clear the
  // scheduled_unblock_at / unblock_job_id columns unconditionally (even for
  // done/cancelled rows) so the UI never shows a stale countdown.
  if (
    row.target_type === 'device' &&
    row.action === 'unblock' &&
    row.run_at != null
  ) {
    await raw(adapter).rawQuery(
      `UPDATE app_block_state
          SET scheduled_unblock_at = NULL, unblock_job_id = NULL
        WHERE device_id = ?`,
      { params: [row.target_id] },
    );
  }

  return loadRow(adapter, id);
}

// ---------------------------------------------------------------------------
// listSchedules
//
// Read app_schedules rows (optionally filtered by target), enrich recurring
// rows with live next_run_at from jobs.schedules.list(), group windows.
// ---------------------------------------------------------------------------

export interface TimerEntry extends ScheduleRow {
  next_run_at?: string | null;
}

export interface WindowEntry {
  window_id: string;
  label: string | null;
  block: ScheduleRow & { next_run_at?: string | null };
  unblock: ScheduleRow & { next_run_at?: string | null };
}

export interface ScheduleList {
  /** Active one-shot unblock rows (timers: block-now + scheduled unblock). */
  timers: TimerEntry[];
  /** Future one-shot block or unblock rows that are still pending. */
  upcoming: TimerEntry[];
  /** Standalone recurring rows NOT part of a window. */
  recurring: TimerEntry[];
  /** Paired recurring window rows, grouped by window_id. */
  windows: WindowEntry[];
}

export async function listSchedules(opts: {
  adapter: HazoConnectAdapter;
  jobs: JobsClient;
  targetType?: 'device' | 'group';
  targetId?: string;
}): Promise<ScheduleList> {
  const { adapter, jobs, targetType, targetId } = opts;

  // Build filter.
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (targetType != null) { conditions.push('target_type = ?'); params.push(targetType); }
  if (targetId != null) { conditions.push('target_id = ?'); params.push(targetId); }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  const rows = await raw(adapter).rawQuery(
    `SELECT * FROM app_schedules${where} ORDER BY created_at DESC`,
    { params },
  ) as ScheduleRow[];

  // Fetch live schedule data from jobs (for next_run_at enrichment).
  const liveSchedules: Array<{ id: string; next_run_at: string }> = await jobs.schedules.list().catch(
    () => [] as Array<{ id: string; next_run_at: string }>,
  );
  const liveMap = new Map<string, { id: string; next_run_at: string }>(
    liveSchedules.map((s) => [s.id, s] as [string, { id: string; next_run_at: string }]),
  );

  // Enrich: add next_run_at to recurring rows.
  const enriched = rows.map((r) => {
    const entry: TimerEntry = { ...r };
    if (r.cron != null && r.job_id) {
      const live = liveMap.get(r.job_id);
      entry.next_run_at = live?.next_run_at ?? null;
    }
    return entry;
  });

  // Partition.
  const timers: TimerEntry[] = [];
  const upcoming: TimerEntry[] = [];
  const recurringNoWindow: TimerEntry[] = [];
  const windowRows: TimerEntry[] = [];

  for (const r of enriched) {
    if (r.cron != null) {
      // Recurring
      if (r.window_id != null) {
        windowRows.push(r);
      } else {
        recurringNoWindow.push(r);
      }
    } else {
      // One-shot
      if (r.action === 'unblock' && r.status === 'active') {
        timers.push(r);
      } else {
        upcoming.push(r);
      }
    }
  }

  // Group window rows into pairs.
  const windowMap = new Map<string, { block?: TimerEntry; unblock?: TimerEntry; label: string | null }>();
  for (const r of windowRows) {
    const wid = r.window_id!;
    if (!windowMap.has(wid)) windowMap.set(wid, { label: r.label, block: undefined, unblock: undefined });
    const entry = windowMap.get(wid)!;
    if (r.action === 'block') entry.block = r;
    else entry.unblock = r;
    // Use a non-directional label if present.
    if (r.label && !entry.label) entry.label = r.label;
  }

  const windows: WindowEntry[] = [];
  for (const [window_id, w] of windowMap) {
    if (w.block && w.unblock) {
      windows.push({ window_id, label: w.label ?? null, block: w.block, unblock: w.unblock });
    }
  }

  return { timers, upcoming, recurring: recurringNoWindow, windows };
}
