import 'server-only';

import { getDb } from '@/server/db';
import { createCrudService } from 'hazo_connect/server';

export interface DeviceRow extends Record<string, unknown> {
  id?: string;
  mac?: string;
  hostname?: string;
  friendly_name?: string | null;
  vendor?: string;
  icon?: string | null;
  notes?: string | null;
  current_ip?: string;
  last_band?: string;
  status?: string;
  is_new?: number;
  first_seen?: string;
  last_seen?: string;
  primary_group_id?: string | null;
  is_blocked?: number;
}

export interface GroupRow extends Record<string, unknown> {
  id?: string;
  name?: string;
  description?: string | null;
  type?: string;
  image_file_id?: string | null;
  color?: string | null;
  created_by?: string | null;
  created_at?: string;
}

/** Annotate devices with is_blocked from app_block_state rows (pure; testable). */
export function mergeBlockState<T extends { id?: string }>(
  devices: T[],
  blockRows: { device_id?: string; is_blocked?: number }[],
): (T & { is_blocked: number })[] {
  const blocked = new Set(
    blockRows.filter((r) => Number(r.is_blocked) === 1).map((r) => r.device_id),
  );
  return devices.map((d) => ({ ...d, is_blocked: blocked.has(d.id) ? 1 : 0 }));
}

export async function listDevicesAndGroups(): Promise<{ devices: DeviceRow[]; groups: GroupRow[] }> {
  const db = getDb();
  const rawDevices = await createCrudService<DeviceRow>(db, 'app_devices').list();
  const groups = await createCrudService<GroupRow>(db, 'app_groups').list();
  const blockRows = await createCrudService<{ device_id?: string; is_blocked?: number }>(
    db, 'app_block_state', { primaryKeys: ['device_id'], autoId: false },
  ).list();
  const devices = mergeBlockState(rawDevices, blockRows);
  return { devices, groups };
}

export async function getDevice(id: string): Promise<DeviceRow | null> {
  return createCrudService<DeviceRow>(getDb(), 'app_devices').findById(id);
}

export async function updateDeviceUserFields(
  id: string,
  patch: {
    friendly_name?: string | null;
    icon?: string | null;
    notes?: string | null;
    primary_group_id?: string | null;
  }
): Promise<DeviceRow | null> {
  const db = getDb();
  const deviceSvc = createCrudService<DeviceRow>(db, 'app_devices');

  const existing = await deviceSvc.findById(id);
  if (!existing) return null;

  // Validate group if provided
  if (patch.primary_group_id != null && patch.primary_group_id !== '') {
    const groupSvc = createCrudService<GroupRow>(db, 'app_groups');
    const group = await groupSvc.findById(patch.primary_group_id);
    if (!group) throw new Error('BAD_GROUP');
  }

  // Build sanitized patch with ONLY allowed user-owned fields that are present
  const sanitized: Partial<DeviceRow> = {};
  if ('friendly_name' in patch) sanitized.friendly_name = patch.friendly_name;
  if ('icon' in patch) sanitized.icon = patch.icon;
  if ('notes' in patch) sanitized.notes = patch.notes;
  if ('primary_group_id' in patch) sanitized.primary_group_id = patch.primary_group_id;

  const updated = await deviceSvc.updateById(id, sanitized);
  return updated[0] ?? (await deviceSvc.findById(id));
}

export async function acknowledgeDevice(id: string): Promise<DeviceRow | null> {
  const db = getDb();
  const deviceSvc = createCrudService<DeviceRow>(db, 'app_devices');

  const existing = await deviceSvc.findById(id);
  if (!existing) return null;

  const updated = await deviceSvc.updateById(id, { is_new: 0 });
  return updated[0] ?? (await deviceSvc.findById(id));
}
