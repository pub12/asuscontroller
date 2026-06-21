'server-only';

import { createCrudService } from 'hazo_connect/server';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import { emitIntentEvent, runWithAuditContext } from 'hazo_audit/server';
import type { RouterProvider } from '../router/RouterProvider';
import { runBlockAction } from '../devices/blockActions';
import { deriveGroupStatus } from './groupService';

export interface GroupBlockSummary {
  groupId: string;
  action: 'block' | 'unblock';
  memberCount: number;
  affected: string[];
  skippedOffline: string[];
  failures: { deviceId: string; message: string }[];
  isBlocked: boolean;
}

export type GroupBlockOutcome =
  | { ok: true; summary: GroupBlockSummary }
  | { ok: false; code: 'NOT_FOUND'; message: string };

interface GroupMemberRow extends Record<string, unknown> {
  group_id?: string;
  device_id?: string;
}

export async function runGroupBlockAction(
  adapter: HazoConnectAdapter,
  provider: RouterProvider,
  gate: { authorized: boolean; actorLabel: string; actorUserId?: string | null },
  groupId: string,
  action: 'block' | 'unblock',
): Promise<GroupBlockOutcome> {
  // Check group exists
  const groupSvc = createCrudService(adapter, 'app_groups');
  const group = await groupSvc.findById(groupId);
  if (!group) {
    return { ok: false, code: 'NOT_FOUND', message: 'Group not found' };
  }

  // Load members RAW — do not use getGroup's joined path so orphan members still get attempted
  const memberSvc = createCrudService<GroupMemberRow>(adapter, 'app_group_members', {
    primaryKeys: ['group_id', 'device_id'],
    autoId: false,
  });
  const memberRows = await memberSvc.findBy({ group_id: groupId });
  const deviceIds = memberRows.map((m) => m.device_id).filter((id): id is string => Boolean(id));

  const affected: string[] = [];
  const skippedOffline: string[] = [];
  const failures: { deviceId: string; message: string }[] = [];

  // Iterate sequentially to avoid CAS contention
  for (const deviceId of deviceIds) {
    try {
      const outcome = await runBlockAction(adapter, provider, gate, deviceId, action);
      if (outcome.ok === true) {
        affected.push(deviceId);
      } else if (outcome.code === 'VALIDATION_FAILED' && action === 'block') {
        // Offline device — skip (not a failure)
        skippedOffline.push(deviceId);
      } else {
        failures.push({ deviceId, message: outcome.message });
      }
    } catch (e) {
      failures.push({ deviceId, message: String(e) });
    }
  }

  // Emit one summary audit event for the group action
  await runWithAuditContext(
    {
      actor_kind: 'user',
      actor_user_id: gate.actorUserId ?? null,
      actor_label: gate.actorLabel,
    },
    async () => {
      await emitIntentEvent(adapter, {
        event_name: action === 'block' ? 'group_blocked' : 'group_unblocked',
        subject_kind: 'group',
        subject_id: groupId,
        payload: {
          action,
          member_count: deviceIds.length,
          affected: affected.length,
          skipped: skippedOffline.length,
          failed: failures.length,
        },
      });
    },
  );

  // Compute post-action isBlocked by reading fresh block state for all members
  const blockSvc = createCrudService<{ device_id?: string; is_blocked?: number }>(
    adapter,
    'app_block_state',
    { primaryKeys: ['device_id'], autoId: false },
  );
  const deviceSvc = createCrudService<{ id?: string; status?: string }>(adapter, 'app_devices');

  const memberStatuses: { is_blocked: number; status?: string | null }[] = [];
  for (const deviceId of deviceIds) {
    const blockRow = await blockSvc.findById(deviceId) as { is_blocked?: number } | null;
    const deviceRow = await deviceSvc.findById(deviceId) as { status?: string } | null;
    memberStatuses.push({
      is_blocked: blockRow ? Number(blockRow.is_blocked) : 0,
      status: deviceRow?.status ?? null,
    });
  }

  const { isBlocked } = deriveGroupStatus(memberStatuses);

  return {
    ok: true,
    summary: {
      groupId,
      action,
      memberCount: deviceIds.length,
      affected,
      skippedOffline,
      failures,
      isBlocked,
    },
  };
}
