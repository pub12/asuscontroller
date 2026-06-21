'server-only';

import { createCrudService } from 'hazo_connect/server';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import { GroupRow, DeviceRow, mergeBlockState } from '@/server/devices/deviceService';

// ── Re-export GroupRow so consumers can import from here ──────────────────────
export type { GroupRow };

// ── Pure helper ───────────────────────────────────────────────────────────────

export interface GroupMemberStatus {
  is_blocked: number;
  status?: string | null;
}

export function deriveGroupStatus(members: GroupMemberStatus[]): {
  memberCount: number;
  onlineCount: number;
  blockedCount: number;
  isBlocked: boolean;
} {
  const memberCount = members.length;
  const onlineCount = members.filter((m) => m.status === 'online').length;
  const blockedCount = members.filter((m) => Number(m.is_blocked) === 1).length;
  const isBlocked = memberCount >= 1 && members.every((m) => Number(m.is_blocked) === 1);
  return { memberCount, onlineCount, blockedCount, isBlocked };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GroupSummary extends GroupRow {
  memberCount: number;
  onlineCount: number;
  blockedCount: number;
  isBlocked: boolean;
}

interface GroupMemberRow extends Record<string, unknown> {
  group_id?: string;
  device_id?: string;
  added_by?: string | null;
  added_at?: string;
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function listGroups(adapter: HazoConnectAdapter): Promise<GroupSummary[]> {
  const groupSvc = createCrudService<GroupRow>(adapter, 'app_groups');
  const memberSvc = createCrudService<GroupMemberRow>(adapter, 'app_group_members', {
    primaryKeys: ['group_id', 'device_id'],
    autoId: false,
  });
  const deviceSvc = createCrudService<DeviceRow>(adapter, 'app_devices');
  const blockSvc = createCrudService<{ device_id?: string; is_blocked?: number }>(
    adapter,
    'app_block_state',
    { primaryKeys: ['device_id'], autoId: false },
  );

  const [groups, allMembers, allDevices, blockRows] = await Promise.all([
    groupSvc.list(),
    memberSvc.list(),
    deviceSvc.list(),
    blockSvc.list(),
  ]);

  // Build device map and annotate with block state
  const annotatedDevices = mergeBlockState(allDevices, blockRows);
  const deviceMap = new Map(annotatedDevices.map((d) => [d.id, d]));

  // Group membership by group_id
  const membersByGroup = new Map<string, (DeviceRow & { is_blocked: number })[]>();
  for (const m of allMembers) {
    if (!m.group_id || !m.device_id) continue;
    const device = deviceMap.get(m.device_id);
    if (!device) continue;
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(device as DeviceRow & { is_blocked: number });
    membersByGroup.set(m.group_id, list);
  }

  return groups.map((group) => {
    const members = membersByGroup.get(group.id as string) ?? [];
    const stats = deriveGroupStatus(members);
    return { ...group, ...stats };
  });
}

export async function getGroup(
  adapter: HazoConnectAdapter,
  id: string,
): Promise<{ group: GroupRow; members: (DeviceRow & { is_blocked: number })[] } | null> {
  const groupSvc = createCrudService<GroupRow>(adapter, 'app_groups');
  const group = await groupSvc.findById(id);
  if (!group) return null;

  const memberSvc = createCrudService<GroupMemberRow>(adapter, 'app_group_members', {
    primaryKeys: ['group_id', 'device_id'],
    autoId: false,
  });
  const deviceSvc = createCrudService<DeviceRow>(adapter, 'app_devices');
  const blockSvc = createCrudService<{ device_id?: string; is_blocked?: number }>(
    adapter,
    'app_block_state',
    { primaryKeys: ['device_id'], autoId: false },
  );

  const memberRows = await memberSvc.findBy({ group_id: id });
  const deviceIds = memberRows.map((m) => m.device_id).filter(Boolean) as string[];

  let members: (DeviceRow & { is_blocked: number })[] = [];
  if (deviceIds.length > 0) {
    const allDevices = await deviceSvc.list();
    const blockRows = await blockSvc.list();
    const annotated = mergeBlockState(allDevices, blockRows);
    members = annotated.filter((d) => d.id != null && deviceIds.includes(d.id as string));
  }

  return { group, members };
}

export async function createGroup(
  adapter: HazoConnectAdapter,
  params: {
    name: string;
    type?: string;
    color?: string | null;
    description?: string | null;
    imageFileId?: string | null;
    memberIds?: string[];
    createdBy?: string | null;
  },
): Promise<GroupRow> {
  const groupSvc = createCrudService<GroupRow>(adapter, 'app_groups');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const row: GroupRow = {
    id,
    name: params.name,
    type: params.type ?? 'generic',
    color: params.color ?? null,
    description: params.description ?? null,
    image_file_id: params.imageFileId ?? null,
    created_by: params.createdBy ?? null,
    created_at: now,
  };

  await groupSvc.insert(row);

  if (params.memberIds && params.memberIds.length > 0) {
    await addMembers(adapter, id, params.memberIds, params.createdBy ?? null);
  }

  const created = await groupSvc.findById(id);
  return created!;
}

export async function updateGroup(
  adapter: HazoConnectAdapter,
  id: string,
  patch: {
    name?: string;
    type?: string;
    color?: string | null;
    description?: string | null;
    imageFileId?: string | null;
    monitoringEnabled?: boolean;
  },
): Promise<GroupRow | null> {
  const groupSvc = createCrudService<GroupRow>(adapter, 'app_groups');
  const existing = await groupSvc.findById(id);
  if (!existing) return null;

  const sanitized: Partial<GroupRow> = {};
  if ('name' in patch) sanitized.name = patch.name;
  if ('type' in patch) sanitized.type = patch.type;
  if ('color' in patch) sanitized.color = patch.color;
  if ('description' in patch) sanitized.description = patch.description;
  if ('imageFileId' in patch) sanitized.image_file_id = patch.imageFileId;
  if ('monitoringEnabled' in patch) sanitized.monitoring_enabled = patch.monitoringEnabled ? 1 : 0;

  const updated = await groupSvc.updateById(id, sanitized);
  return (updated[0] ?? (await groupSvc.findById(id))) ?? null;
}

export async function deleteGroup(adapter: HazoConnectAdapter, id: string): Promise<boolean> {
  const groupSvc = createCrudService<GroupRow>(adapter, 'app_groups');
  const existing = await groupSvc.findById(id);
  if (!existing) return false;

  // Delete all group member rows using the query builder (composite PK)
  const memberSvc = createCrudService<GroupMemberRow>(adapter, 'app_group_members', {
    primaryKeys: ['group_id', 'device_id'],
    autoId: false,
  });
  await memberSvc.query().where('group_id', 'eq', id).execute('DELETE');

  // Null out primary_group_id on devices referencing this group
  const deviceSvc = createCrudService<DeviceRow>(adapter, 'app_devices');
  const affected = await deviceSvc.findBy({ primary_group_id: id });
  for (const device of affected) {
    if (device.id) {
      await deviceSvc.updateById(device.id as string, { primary_group_id: null });
    }
  }

  // Delete the group
  await groupSvc.deleteById(id);
  return true;
}

export async function addMembers(
  adapter: HazoConnectAdapter,
  id: string,
  deviceIds: string[],
  addedBy?: string | null,
): Promise<void> {
  const memberSvc = createCrudService<GroupMemberRow>(adapter, 'app_group_members', {
    primaryKeys: ['group_id', 'device_id'],
    autoId: false,
  });
  const deviceSvc = createCrudService<DeviceRow>(adapter, 'app_devices');
  const now = new Date().toISOString();

  for (const deviceId of deviceIds) {
    // Check device exists
    const device = await deviceSvc.findById(deviceId);
    if (!device) continue;

    // Check if already a member (idempotent)
    const existing = await memberSvc.findBy({ group_id: id, device_id: deviceId });
    if (existing.length === 0) {
      await memberSvc.insert({
        group_id: id,
        device_id: deviceId,
        added_by: addedBy ?? null,
        added_at: now,
      });
    }

    // Set primary_group_id if not already set (first-group-add rule)
    if (!device.primary_group_id) {
      await deviceSvc.updateById(deviceId, { primary_group_id: id });
    }
  }
}

export async function removeMember(
  adapter: HazoConnectAdapter,
  id: string,
  deviceId: string,
): Promise<void> {
  const memberSvc = createCrudService<GroupMemberRow>(adapter, 'app_group_members', {
    primaryKeys: ['group_id', 'device_id'],
    autoId: false,
  });
  const deviceSvc = createCrudService<DeviceRow>(adapter, 'app_devices');

  // Delete by composite PK using query builder
  await memberSvc
    .query()
    .where('group_id', 'eq', id)
    .where('device_id', 'eq', deviceId)
    .execute('DELETE');

  // Null out primary_group_id if it pointed at this group
  const device = await deviceSvc.findById(deviceId);
  if (device && device.primary_group_id === id) {
    await deviceSvc.updateById(deviceId, { primary_group_id: null });
  }
}
