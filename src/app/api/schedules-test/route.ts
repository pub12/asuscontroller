/**
 * src/app/api/schedules-test/route.ts
 *
 * Hermetic autotests for the schedules feature.
 *
 * Uses a throwaway temp SQLite DB — the dev DB is NEVER touched.
 * Returns 404 in production.
 *
 * Flags:
 *   timer_ok           — createTimer blocks immediately + schedules unblock
 *   future_block_ok    — createFutureBlock creates pending one-shot row, no immediate block
 *   fire_ok            — runScheduleFire fires a schedule, device blocked, row → 'done'
 *   recurring_ok       — createRecurring creates active cron row; listSchedules returns it
 *   early_unblock_ok   — timer device: manual unblockDevice(jobs) cancels pending job + row
 *   schedule_authz_ok  — authorizeCapability enforces schedule.create correctly
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { createTimer, createFutureBlock, createRecurring, listSchedules } from '@/server/schedules/scheduleService';
import { getJobsClientFor } from '@/server/schedules/jobsAdapter';
import { runScheduleFire } from '@/server/schedules/runScheduleFire';
import { unblockDevice } from '@/server/devices/blockService';
import { authorizeCapability } from '@/server/permissions/authorize';
import { createGrant } from '@/server/permissions/grantsService';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

// Raw adapter type used for direct SQL queries — mirrors pattern from runDeviceSync.ts
type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_schedules_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  const debug: Record<string, unknown> = {};

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: tmpDb,
        driver: 'better-sqlite3',
      },
    });

    // 1. Run all migrations
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    // 2. Build hazo_jobs client over the temp adapter (applyDdl is idempotent)
    const jobs = await getJobsClientFor(adapter);

    // 3. Seed devices
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd_online', mac: 'AA:BB:CC:01:00:01', status: 'online',
    });
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd_online2', mac: 'AA:BB:CC:01:00:02', status: 'online',
    });
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd_offline', mac: 'AA:BB:CC:01:00:03', status: 'offline',
    });

    // 4. Seed a group with one online member
    await createCrudService(adapter, 'app_groups').insert({
      id: 'g1', name: 'Test Group',
    });
    await createCrudService(adapter, 'app_group_members', {
      primaryKeys: ['group_id', 'device_id'],
      autoId: false,
    }).insert({
      group_id: 'g1',
      device_id: 'd_online',
      added_by: 'tester',
      added_at: new Date().toISOString(),
    });

    // 5. Create fake router provider
    const fake = new FakeRouterProvider();

    const actor = { label: 'tester@example.com' };

    // -------------------------------------------------------------------------
    // timer_ok — createTimer blocks device immediately + schedules an unblock
    // Verify: status='active', run_at set, cron=null, job_id set,
    //         app_block_state shows the device IS blocked now.
    // -------------------------------------------------------------------------
    let timer_ok = false;
    let timerRow: Record<string, unknown> | null = null;
    {
      const row = await createTimer({
        adapter, jobs, provider: fake,
        targetType: 'device', targetId: 'd_online',
        durationMin: 60,
        actor,
      });
      timerRow = row as unknown as Record<string, unknown>;

      // Check schedule row
      const rowStatus = row.status === 'active';
      const rowRunAt = row.run_at != null;
      const rowCronNull = row.cron == null;
      const rowJobId = row.job_id != null && row.job_id !== '';

      // createTimer calls runBlockAction which calls blockDevice, so app_block_state should be set
      const blockState = await (adapter as unknown as RawAdapter).rawQuery(
        'SELECT is_blocked, unblock_job_id FROM app_block_state WHERE device_id = ?',
        { params: ['d_online'] },
      ) as { is_blocked: number; unblock_job_id: string | null }[];

      const deviceBlocked = blockState.length > 0 && Number(blockState[0].is_blocked) === 1;
      const unblockJobIdSet = blockState.length > 0 && blockState[0].unblock_job_id != null;

      debug.timer_row = { status: row.status, run_at: row.run_at, cron: row.cron, job_id: row.job_id, action: row.action };
      debug.timer_block_state = blockState[0] ?? null;

      timer_ok = rowStatus && rowRunAt && rowCronNull && rowJobId && deviceBlocked && unblockJobIdSet;
    }

    // -------------------------------------------------------------------------
    // future_block_ok — createFutureBlock: pending one-shot, device NOT yet blocked
    // -------------------------------------------------------------------------
    let future_block_ok = false;
    let futureBlockScheduleId = '';
    {
      const futureISO = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour from now

      const row = await createFutureBlock({
        adapter, jobs,
        targetType: 'device', targetId: 'd_online2',
        action: 'block',
        atISO: futureISO,
        actor,
      });
      futureBlockScheduleId = row.id;

      const rowStatus = row.status === 'active';
      const rowRunAtMatches = row.run_at === futureISO;
      const rowCronNull = row.cron == null;
      const rowJobId = row.job_id != null && row.job_id !== '';

      // d_online2 should NOT be blocked yet
      const blockState = await (adapter as unknown as RawAdapter).rawQuery(
        'SELECT is_blocked FROM app_block_state WHERE device_id = ?',
        { params: ['d_online2'] },
      ) as { is_blocked: number }[];

      const notYetBlocked = blockState.length === 0 || Number(blockState[0].is_blocked) === 0;

      debug.future_block_row = { status: row.status, run_at: row.run_at, cron: row.cron, job_id: row.job_id };
      debug.future_block_state = blockState[0] ?? null;

      future_block_ok = rowStatus && rowRunAtMatches && rowCronNull && rowJobId && notYetBlocked;
    }

    // -------------------------------------------------------------------------
    // fire_ok — runScheduleFire fires the future block schedule:
    //   - result.affected includes 'd_online2'
    //   - app_block_state.is_blocked = 1 for d_online2
    //   - the schedule row flips to status='done'
    // -------------------------------------------------------------------------
    let fire_ok = false;
    {
      const result = await runScheduleFire(
        adapter as unknown as { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> },
        fake,
        { targetType: 'device', targetId: 'd_online2', action: 'block', scheduleId: futureBlockScheduleId },
      );

      const affected = result.affected.includes('d_online2');
      const scheduleStatus = result.scheduleStatus === 'done';

      // Check block state
      const blockState = await (adapter as unknown as RawAdapter).rawQuery(
        'SELECT is_blocked FROM app_block_state WHERE device_id = ?',
        { params: ['d_online2'] },
      ) as { is_blocked: number }[];
      const nowBlocked = blockState.length > 0 && Number(blockState[0].is_blocked) === 1;

      // Check schedule row
      const schedRow = await (adapter as unknown as RawAdapter).rawQuery(
        'SELECT status FROM app_schedules WHERE id = ?',
        { params: [futureBlockScheduleId] },
      ) as { status: string }[];
      const rowDone = schedRow.length > 0 && schedRow[0].status === 'done';

      debug.fire_result = { affected: result.affected, skipped: result.skipped, failures: result.failures, scheduleStatus: result.scheduleStatus };
      debug.fire_block_state = blockState[0] ?? null;
      debug.fire_sched_row = schedRow[0] ?? null;

      fire_ok = affected && scheduleStatus && nowBlocked && rowDone;
    }

    // -------------------------------------------------------------------------
    // recurring_ok — createRecurring: active cron row, listSchedules returns it under recurring
    // -------------------------------------------------------------------------
    let recurring_ok = false;
    {
      const row = await createRecurring({
        adapter, jobs,
        targetType: 'device', targetId: 'd_online2',
        action: 'block',
        cron: '0 22 * * *',
        label: 'nightly block',
        actor,
      });

      const rowStatus = row.status === 'active';
      const rowCron = row.cron === '0 22 * * *';
      const rowRunAtNull = row.run_at == null;
      const rowJobId = row.job_id != null && row.job_id !== '';

      // listSchedules should include this in recurring
      const schedList = await listSchedules({ adapter, jobs });
      const foundInRecurring = schedList.recurring.some((r) => r.id === row.id);

      debug.recurring_row = { status: row.status, cron: row.cron, run_at: row.run_at, job_id: row.job_id };
      debug.recurring_list_count = schedList.recurring.length;

      recurring_ok = rowStatus && rowCron && rowRunAtNull && rowJobId && foundInRecurring;
    }

    // -------------------------------------------------------------------------
    // early_unblock_ok — timer was created for d_online (blocked now + pending unblock job).
    //   Call unblockDevice with jobs → pending unblock job cancelled + schedule row 'cancelled'
    //   + device is unblocked.
    // -------------------------------------------------------------------------
    let early_unblock_ok = false;
    {
      // timerRow was created above for d_online. It has job_id = the unblock job id.
      const timerJobId = timerRow ? String(timerRow.job_id) : null;
      const timerScheduleId = timerRow ? String(timerRow.id) : null;

      debug.early_unblock_timer_job_id = timerJobId;

      // Verify d_online is currently blocked (set up by createTimer)
      const beforeState = await (adapter as unknown as RawAdapter).rawQuery(
        'SELECT is_blocked, unblock_job_id FROM app_block_state WHERE device_id = ?',
        { params: ['d_online'] },
      ) as { is_blocked: number; unblock_job_id: string | null }[];
      debug.early_unblock_before_state = beforeState[0] ?? null;

      // Call unblockDevice with the jobs client — this triggers the early-unblock hook
      const unblockResult = await unblockDevice(adapter, fake, 'd_online', {
        actor,
        jobs,
      });

      // Check device is unblocked
      const afterState = await (adapter as unknown as RawAdapter).rawQuery(
        'SELECT is_blocked, unblock_job_id FROM app_block_state WHERE device_id = ?',
        { params: ['d_online'] },
      ) as { is_blocked: number; unblock_job_id: string | null }[];
      const deviceUnblocked = afterState.length > 0 && Number(afterState[0].is_blocked) === 0;

      // Check app_schedules row was cancelled (the timer schedule row)
      const schedRow = timerScheduleId
        ? await (adapter as unknown as RawAdapter).rawQuery(
            'SELECT status FROM app_schedules WHERE id = ?',
            { params: [timerScheduleId] },
          ) as { status: string }[]
        : [];
      const schedCancelled = schedRow.length > 0 && schedRow[0].status === 'cancelled';

      debug.early_unblock_unblock_result = { blocked: unblockResult.blocked, alreadyInState: unblockResult.alreadyInState };
      debug.early_unblock_after_state = afterState[0] ?? null;
      debug.early_unblock_sched_row = schedRow[0] ?? null;

      early_unblock_ok = unblockResult.blocked === false && deviceUnblocked && schedCancelled;
    }

    // -------------------------------------------------------------------------
    // schedule_authz_ok — authorizeCapability enforces schedule.create
    //   - superadmin → allowed=true
    //   - non-superadmin with no grant → allowed=false
    //   - non-superadmin with a global schedule.create grant → allowed=true
    // -------------------------------------------------------------------------
    let schedule_authz_ok = false;
    {
      // Superadmin bypass
      const superadminDecision = await authorizeCapability(
        adapter,
        { subject: null, isSuperadmin: true },
        'schedule.create',
      );
      const superadminAllowed = superadminDecision.allowed === true;

      // Non-superadmin, no grant → denied
      const denyDecision = await authorizeCapability(
        adapter,
        { subject: 'user@test.local', isSuperadmin: false },
        'schedule.create',
      );
      const noGrantDenied = denyDecision.allowed === false;

      // Grant a global schedule.create capability then re-check
      await createGrant(adapter, {
        subject: 'user@test.local',
        capability: 'schedule.create',
        scopeType: 'global',
        scopeId: null,
        grantedBy: 'admin',
      });
      const allowDecision = await authorizeCapability(
        adapter,
        { subject: 'user@test.local', isSuperadmin: false },
        'schedule.create',
      );
      const grantAllowed = allowDecision.allowed === true;

      debug.schedule_authz = {
        superadminAllowed,
        noGrantDenied,
        grantAllowed,
        denyReason: denyDecision.reason,
        allowReason: allowDecision.reason,
      };

      schedule_authz_ok = superadminAllowed && noGrantDenied && grantAllowed;
    }

    const all_ok =
      timer_ok &&
      future_block_ok &&
      fire_ok &&
      recurring_ok &&
      early_unblock_ok &&
      schedule_authz_ok;

    return Response.json({
      ok: true,
      all_ok,
      timer_ok,
      future_block_ok,
      fire_ok,
      recurring_ok,
      early_unblock_ok,
      schedule_authz_ok,
      ...debug,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err), stack: err instanceof Error ? err.stack : undefined, ...debug }, { status: 500 });
  } finally {
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    } catch {
      // best-effort cleanup
    }
  }
}
