/**
 * src/app/api/groups-test/route.ts
 *
 * Hermetic autotest for groupService (Group CRUD + membership).
 *
 * Checks:
 *  - create_ok: createGroup returns a row with an id and name.
 *  - member_count_ok: after adding 2 devices (one online, one offline), listGroups shows
 *      memberCount===2 and onlineCount===1 for that group.
 *  - primary_on_first_add_ok: a device with NULL primary_group_id gets it set to the group
 *      after addMembers; a device that already has a primary keeps its original primary.
 *  - block_status_ok: with both unblocked → isBlocked false; both blocked → isBlocked true;
 *      only one blocked → isBlocked false.
 *  - remove_member_ok: removeMember drops the row (memberCount decreases) and nulls
 *      primary_group_id if it pointed at the group.
 *  - delete_nulls_primary_ok: deleteGroup removes member rows AND nulls primary_group_id on
 *      devices that referenced it AND removes the group (getGroup → null).
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMember,
  deriveGroupStatus,
} from '@/server/groups/groupService';
import { getDeviceDomainInsights } from '@/server/telemetry/deviceDomainInsights';
import os from 'os';
import path from 'path';
import fs from 'fs';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_groups_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
    });

    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    const nowIso = new Date().toISOString();
    const deviceSvc = createCrudService<Record<string, unknown>>(adapter, 'app_devices');
    const blockSvc = createCrudService<Record<string, unknown>>(adapter, 'app_block_state', {
      primaryKeys: ['device_id'],
      autoId: false,
    });

    // ── Seed two devices ──────────────────────────────────────────────────────
    await deviceSvc.insert({ id: 'dev1', mac: 'AA:BB:CC:00:00:01', status: 'online', last_seen: nowIso });
    await deviceSvc.insert({ id: 'dev2', mac: 'AA:BB:CC:00:00:02', status: 'offline', last_seen: nowIso });

    // ── create_ok ─────────────────────────────────────────────────────────────
    const group = await createGroup(adapter, { name: 'Test Group', type: 'generic', createdBy: 'tester' });
    const create_ok = typeof group.id === 'string' && group.id.length > 0 && group.name === 'Test Group';

    // ── member_count_ok ───────────────────────────────────────────────────────
    await addMembers(adapter, group.id as string, ['dev1', 'dev2'], 'tester');
    const summaries = await listGroups(adapter);
    const summary = summaries.find((g) => g.id === group.id);
    const member_count_ok =
      summary !== undefined &&
      summary.memberCount === 2 &&
      summary.onlineCount === 1;

    // ── primary_on_first_add_ok ───────────────────────────────────────────────
    // dev1 and dev2 both had null primary_group_id initially, so they should now
    // have primary_group_id === group.id after addMembers above.
    // Create a second group and add dev1 again — dev1's primary should stay unchanged.
    const group2 = await createGroup(adapter, { name: 'Second Group', createdBy: 'tester' });
    // Add a new device with NULL primary
    await deviceSvc.insert({ id: 'dev3', mac: 'AA:BB:CC:00:00:03', status: 'online', last_seen: nowIso });
    await addMembers(adapter, group.id as string, ['dev3'], 'tester');
    const dev3Row = await createCrudService<Record<string, unknown>>(adapter, 'app_devices').findById('dev3');
    const dev3PrimarySetCorrectly = dev3Row?.primary_group_id === group.id;

    // Now add dev3 to group2 — dev3 already has a primary, so it should NOT change
    await addMembers(adapter, group2.id as string, ['dev3'], 'tester');
    const dev3RowAfter = await createCrudService<Record<string, unknown>>(adapter, 'app_devices').findById('dev3');
    const dev3PrimaryUnchanged = dev3RowAfter?.primary_group_id === group.id;

    const primary_on_first_add_ok = dev3PrimarySetCorrectly && dev3PrimaryUnchanged;

    // ── block_status_ok ───────────────────────────────────────────────────────
    // Both unblocked → isBlocked false
    const summaries1 = await listGroups(adapter);
    const summary1 = summaries1.find((g) => g.id === group.id);
    const both_unblocked = summary1 !== undefined && summary1.isBlocked === false;

    // Insert block state is_blocked=1 for BOTH dev1 and dev2
    await blockSvc.insert({ device_id: 'dev1', is_blocked: 1, blocked_by: 'tester', blocked_at: nowIso, reason: null, scheduled_unblock_at: null, unblock_job_id: null, router_synced: 0 });
    await blockSvc.insert({ device_id: 'dev2', is_blocked: 1, blocked_by: 'tester', blocked_at: nowIso, reason: null, scheduled_unblock_at: null, unblock_job_id: null, router_synced: 0 });

    // Also need dev3 blocked since it's in the group
    await blockSvc.insert({ device_id: 'dev3', is_blocked: 1, blocked_by: 'tester', blocked_at: nowIso, reason: null, scheduled_unblock_at: null, unblock_job_id: null, router_synced: 0 });

    const summaries2 = await listGroups(adapter);
    const summary2 = summaries2.find((g) => g.id === group.id);
    const all_blocked = summary2 !== undefined && summary2.isBlocked === true;

    // Unblock dev1 → only one blocked → isBlocked false
    await blockSvc.updateById('dev1', { is_blocked: 0 });
    const summaries3 = await listGroups(adapter);
    const summary3 = summaries3.find((g) => g.id === group.id);
    const partial_blocked = summary3 !== undefined && summary3.isBlocked === false;

    const block_status_ok = both_unblocked && all_blocked && partial_blocked;

    // ── remove_member_ok ──────────────────────────────────────────────────────
    // dev1's primary_group_id should be group.id; remove dev1 and verify
    const dev1RowBefore = await createCrudService<Record<string, unknown>>(adapter, 'app_devices').findById('dev1');
    const dev1HadPrimary = dev1RowBefore?.primary_group_id === group.id;

    await removeMember(adapter, group.id as string, 'dev1');

    const summaries4 = await listGroups(adapter);
    const summary4 = summaries4.find((g) => g.id === group.id);
    const countDecreased = summary4 !== undefined && summary4.memberCount === 2; // dev2 + dev3 remain

    const dev1RowAfterRemove = await createCrudService<Record<string, unknown>>(adapter, 'app_devices').findById('dev1');
    const dev1PrimaryNulled = dev1RowAfterRemove?.primary_group_id == null;

    const remove_member_ok = dev1HadPrimary && countDecreased && dev1PrimaryNulled;

    // ── delete_nulls_primary_ok ───────────────────────────────────────────────
    // dev2 and dev3 are still in the group with primary_group_id === group.id
    const dev2RowBefore = await createCrudService<Record<string, unknown>>(adapter, 'app_devices').findById('dev2');
    const dev2HadPrimary = dev2RowBefore?.primary_group_id === group.id;

    await deleteGroup(adapter, group.id as string);

    const groupAfterDelete = await getGroup(adapter, group.id as string);
    const groupGone = groupAfterDelete === null;

    const dev2RowAfterDelete = await createCrudService<Record<string, unknown>>(adapter, 'app_devices').findById('dev2');
    const dev2PrimaryNulled = dev2RowAfterDelete?.primary_group_id == null;

    const delete_nulls_primary_ok = dev2HadPrimary && groupGone && dev2PrimaryNulled;

    // ── monitoring_ok (S3: per-group privacy flag, end-to-end) ────────────────
    // Fresh group + device + domain event; default monitoring ON, then toggle OFF.
    const mGroup = await createGroup(adapter, { name: 'Monitoring Group', createdBy: 'tester' });
    await deviceSvc.insert({ id: 'devM', mac: 'AA:BB:CC:00:00:0M', status: 'online', last_seen: nowIso });
    await addMembers(adapter, mGroup.id as string, ['devM'], 'tester'); // sets devM.primary_group_id = mGroup
    const todayIso = nowIso.slice(0, 10);
    const domainEventSvc = createCrudService<Record<string, unknown>>(adapter, 'app_domain_events');
    await domainEventSvc.insert({ id: 'domM_1', device_id: 'devM', domain: 'example.com', ts: nowIso, blocked: 0 });

    // Default ON: monitoring_enabled defaults to 1, insights returns data.
    const mGroupRow = await getGroup(adapter, mGroup.id as string);
    const defaultOn = Number(mGroupRow?.group.monitoring_enabled ?? 1) === 1;
    const insightsOn = await getDeviceDomainInsights(adapter, 'devM', todayIso, 'today');
    const dataVisibleWhenOn = insightsOn.monitoringEnabled === true && insightsOn.topDomains.length === 1;

    // Toggle OFF via the service write path.
    await updateGroup(adapter, mGroup.id as string, { monitoringEnabled: false });
    const mGroupRowOff = await getGroup(adapter, mGroup.id as string);
    const persistedOff = Number(mGroupRowOff?.group.monitoring_enabled) === 0;
    const insightsOff = await getDeviceDomainInsights(adapter, 'devM', todayIso, 'today');
    const dataHiddenWhenOff = insightsOff.monitoringEnabled === false && insightsOff.topDomains.length === 0;

    const monitoring_ok = defaultOn && dataVisibleWhenOn && persistedOff && dataHiddenWhenOff;

    // ── Aggregate ─────────────────────────────────────────────────────────────
    const all_ok =
      create_ok &&
      member_count_ok &&
      primary_on_first_add_ok &&
      block_status_ok &&
      remove_member_ok &&
      delete_nulls_primary_ok &&
      monitoring_ok;

    return Response.json({
      ok: true,
      all_ok,
      create_ok,
      member_count_ok,
      primary_on_first_add_ok,
      block_status_ok,
      remove_member_ok,
      delete_nulls_primary_ok,
      monitoring_ok,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    } catch {
      // best-effort cleanup
    }
  }
}
