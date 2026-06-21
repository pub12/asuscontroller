/**
 * src/server/schedules/runScheduleFire.ts
 *
 * Worker-pure schedule fire core. Called by the background worker when a
 * netwarden.block or netwarden.unblock job fires.
 *
 * IMPORTANT CONSTRAINTS (enforced by design — mirror runDeviceSync.ts):
 *  - NO `import 'server-only'` — this file is imported by scripts/worker.mjs
 *    under plain Node v25 type-stripping. That runtime cannot resolve 'server-only'.
 *  - NO `@/` alias imports — the worker runs without Next.js module aliases.
 *  - NO extensionless relative VALUE imports — type-stripping does not resolve
 *    .ts extensions for relative value imports from worker.mjs context.
 *  - Allowed runtime imports: package imports (hazo_connect/server,
 *    hazo_audit/server) and Node globals (crypto.randomUUID).
 *  - `import type` from relative paths is fine — erased at runtime.
 *  - All block/unblock logic is inlined (do NOT import blockService — it uses
 *    @/ aliases and server-only).
 *
 * Mirrors blockService.ts writes exactly (app_block_state upserts, emitIntentEvent)
 * EXCEPT: hazo_state block:<id> marker is deliberately SKIPPED here — runDeviceSync
 * also skips it; it is not read by any worker path.
 */

import { emitIntentEvent, runWithAuditContext } from 'hazo_audit/server';
import type { RouterProvider } from '../router/RouterProvider';

// ---------------------------------------------------------------------------
// Inline adapter contract — zero runtime imports from relative paths.
// ---------------------------------------------------------------------------
type FireAdapter = {
  rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScheduleFireInput {
  targetType: 'device' | 'group';
  targetId: string;
  action: 'block' | 'unblock';
  scheduleId: string;
}

export interface ScheduleFireResult {
  targetType: 'device' | 'group';
  targetId: string;
  action: 'block' | 'unblock';
  affected: string[];
  skipped: string[];
  failures: { deviceId: string; message: string }[];
  scheduleStatus: 'done' | 'active';
}

// ---------------------------------------------------------------------------
// Internal: apply block/unblock to a single device, inline (no blockService import).
// Returns 'affected' | 'skipped' | 'failure:<msg>'
// ---------------------------------------------------------------------------
async function applyDeviceAction(
  adapter: FireAdapter,
  provider: RouterProvider,
  deviceId: string,
  action: 'block' | 'unblock',
  scheduleId: string,
): Promise<'affected' | 'skipped' | { failure: string }> {
  // Load device row.
  const rows = await adapter.rawQuery(
    'SELECT id, mac, status FROM app_devices WHERE id = ?',
    { params: [deviceId] },
  ) as { id: string; mac: string; status: string }[];

  if (rows.length === 0) return { failure: 'device not found' };
  const device = rows[0];
  const mac = device.mac;

  // Load existing block state.
  const blockRows = await adapter.rawQuery(
    'SELECT is_blocked FROM app_block_state WHERE device_id = ?',
    { params: [deviceId] },
  ) as { is_blocked: number }[];
  const existing = blockRows.length > 0 ? blockRows[0] : null;

  const currentlyBlocked = existing ? Number(existing.is_blocked) === 1 : false;

  if (action === 'block') {
    // Skip offline devices on block (not a failure — just skip).
    if (device.status !== 'online') return 'skipped';
    // Idempotent — already blocked.
    if (currentlyBlocked) return 'affected';

    // Issue router call.
    const result = await provider.setInternetAccess(mac, false);
    const routerSynced = result.success;
    const now = new Date().toISOString();

    // Upsert app_block_state mirroring blockService.blockDevice exactly (minus hazo_state marker).
    await adapter.rawQuery(
      `INSERT INTO app_block_state
         (device_id, is_blocked, blocked_by, blocked_at, reason, scheduled_unblock_at, unblock_job_id, router_synced)
       VALUES (?, 1, ?, ?, NULL, NULL, NULL, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         is_blocked = 1,
         blocked_by = excluded.blocked_by,
         blocked_at = excluded.blocked_at,
         reason = NULL,
         scheduled_unblock_at = NULL,
         unblock_job_id = NULL,
         router_synced = excluded.router_synced`,
      { params: [deviceId, 'schedule:' + scheduleId, now, routerSynced ? 1 : 0] },
    );

    // Best-effort audit event.
    try {
      await emitIntentEvent(adapter as any, {
        event_name: 'device_blocked',
        subject_kind: 'device',
        subject_id: deviceId,
        payload: { mac, via: 'schedule', schedule_id: scheduleId },
      });
    } catch { /* audit is best-effort */ }

    return 'affected';
  } else {
    // action === 'unblock'
    // Idempotent — already unblocked.
    if (!existing || !currentlyBlocked) return 'affected';

    // Issue router call.
    const result = await provider.setInternetAccess(mac, true);
    const routerSynced = result.success;

    // Upsert app_block_state mirroring blockService.unblockDevice exactly (minus hazo_state marker).
    await adapter.rawQuery(
      `INSERT INTO app_block_state
         (device_id, is_blocked, blocked_by, blocked_at, reason, scheduled_unblock_at, unblock_job_id, router_synced)
       VALUES (?, 0, NULL, NULL, NULL, NULL, NULL, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         is_blocked = 0,
         blocked_by = NULL,
         blocked_at = NULL,
         reason = NULL,
         scheduled_unblock_at = NULL,
         unblock_job_id = NULL,
         router_synced = excluded.router_synced`,
      { params: [deviceId, routerSynced ? 1 : 0] },
    );

    // Best-effort audit event.
    try {
      await emitIntentEvent(adapter as any, {
        event_name: 'device_unblocked',
        subject_kind: 'device',
        subject_id: deviceId,
        payload: { mac, via: 'schedule', schedule_id: scheduleId },
      });
    } catch { /* audit is best-effort */ }

    return 'affected';
  }
}

// ---------------------------------------------------------------------------
// Main export: runScheduleFire
// ---------------------------------------------------------------------------

export async function runScheduleFire(
  adapter: FireAdapter,
  provider: RouterProvider,
  input: ScheduleFireInput,
): Promise<ScheduleFireResult> {
  const { targetType, targetId, action, scheduleId } = input;
  const affected: string[] = [];
  const skipped: string[] = [];
  const failures: { deviceId: string; message: string }[] = [];

  await runWithAuditContext(
    { actor_kind: 'system', actor_user_id: null, actor_label: 'schedule:' + scheduleId },
    async () => {
      if (targetType === 'device') {
        // --- Single device ---
        try {
          const outcome = await applyDeviceAction(adapter, provider, targetId, action, scheduleId);
          if (outcome === 'affected') {
            affected.push(targetId);
          } else if (outcome === 'skipped') {
            skipped.push(targetId);
          } else {
            failures.push({ deviceId: targetId, message: outcome.failure });
          }
        } catch (err) {
          failures.push({ deviceId: targetId, message: String(err) });
        }
      } else {
        // --- Group: iterate members ---
        const memberRows = await adapter.rawQuery(
          'SELECT device_id FROM app_group_members WHERE group_id = ?',
          { params: [targetId] },
        ) as { device_id: string }[];

        for (const { device_id } of memberRows) {
          try {
            const outcome = await applyDeviceAction(adapter, provider, device_id, action, scheduleId);
            if (outcome === 'affected') {
              affected.push(device_id);
            } else if (outcome === 'skipped') {
              skipped.push(device_id);
            } else {
              failures.push({ deviceId: device_id, message: outcome.failure });
            }
          } catch (err) {
            failures.push({ deviceId: device_id, message: String(err) });
          }
        }

        // Emit one group-level summary event.
        try {
          await emitIntentEvent(adapter as any, {
            event_name: action === 'block' ? 'group_blocked' : 'group_unblocked',
            subject_kind: 'group',
            subject_id: targetId,
            payload: {
              via: 'schedule',
              schedule_id: scheduleId,
              member_count: memberRows.length,
              affected: affected.length,
              skipped: skipped.length,
              failed: failures.length,
            },
          });
        } catch { /* audit is best-effort */ }
      }
    },
  );

  // Determine schedule status: one-shot → 'done'; recurring → 'active'.
  const schedRows = await adapter.rawQuery(
    'SELECT run_at, cron FROM app_schedules WHERE id = ?',
    { params: [scheduleId] },
  ) as { run_at: string | null; cron: string | null }[];

  let scheduleStatus: 'done' | 'active' = 'active';
  if (schedRows.length > 0) {
    const row = schedRows[0];
    if (row.run_at != null && row.cron == null) {
      // One-shot schedule — mark done.
      await adapter.rawQuery(
        `UPDATE app_schedules SET status = 'done' WHERE id = ?`,
        { params: [scheduleId] },
      );
      scheduleStatus = 'done';
    }
    // Recurring schedules stay 'active'; no columns to update here.
  }

  return { targetType, targetId, action, affected, skipped, failures, scheduleStatus };
}
