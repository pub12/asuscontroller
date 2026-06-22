/**
 * src/server/schedules/policyService.ts
 * Server-only CRUD + lifecycle for declarative recurring schedule policies.
 */
import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import type { RouterProvider } from '../router/RouterProvider';
import { policyState, nextTransition, type PolicyRule } from '@/server/sync/runDeviceSync';
import { runBlockAction } from '../devices/blockActions';
import { runGroupBlockAction } from '../groups/groupBlockActions';

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };
const raw = (a: HazoConnectAdapter): RawAdapter => a as unknown as RawAdapter;

export interface PolicyWithRules {
  id: string;
  target_type: 'device' | 'group';
  target_id: string;
  enabled: boolean;
  tz: string;
  label: string | null;
  rules: PolicyRule[];
}

const POLICY_TZ = 'Australia/Melbourne';

async function loadRules(adapter: HazoConnectAdapter, policyId: string): Promise<PolicyRule[]> {
  const rows = await raw(adapter).rawQuery(
    `SELECT weekday, time_min, action FROM app_schedule_rules WHERE policy_id = ? ORDER BY weekday, time_min`,
    { params: [policyId] },
  );
  return rows.map((r) => ({ weekday: Number(r.weekday), time_min: Number(r.time_min), action: r.action }));
}

async function loadPolicyRow(adapter: HazoConnectAdapter, where: string, params: unknown[]): Promise<PolicyWithRules | null> {
  const rows = await raw(adapter).rawQuery(`SELECT * FROM app_schedule_policies WHERE ${where} LIMIT 1`, { params });
  if (rows.length === 0) return null;
  const p = rows[0];
  return {
    id: p.id, target_type: p.target_type, target_id: p.target_id,
    enabled: Number(p.enabled) === 1, tz: p.tz ?? POLICY_TZ, label: p.label ?? null,
    rules: await loadRules(adapter, p.id),
  };
}

export async function getPolicy(adapter: HazoConnectAdapter, targetType: 'device' | 'group', targetId: string): Promise<PolicyWithRules | null> {
  return loadPolicyRow(adapter, 'target_type = ? AND target_id = ?', [targetType, targetId]);
}

export async function getEnabledPolicyForDevice(adapter: HazoConnectAdapter, deviceId: string): Promise<PolicyWithRules | null> {
  const own = await loadPolicyRow(adapter, "target_type = 'device' AND target_id = ? AND enabled = 1", [deviceId]);
  if (own) return own;
  const dev = await raw(adapter).rawQuery(`SELECT primary_group_id FROM app_devices WHERE id = ?`, { params: [deviceId] });
  const gid = dev[0]?.primary_group_id;
  if (!gid) return null;
  return loadPolicyRow(adapter, "target_type = 'group' AND target_id = ? AND enabled = 1", [gid]);
}

export async function upsertPolicy(adapter: HazoConnectAdapter, opts: {
  targetType: 'device' | 'group'; targetId: string; enabled: boolean;
  label?: string | null; rules: PolicyRule[]; actor: { userId?: string | null };
}): Promise<PolicyWithRules> {
  const now = new Date().toISOString();
  const existing = await getPolicy(adapter, opts.targetType, opts.targetId);
  const id = existing?.id ?? 'pol_' + crypto.randomUUID();
  if (existing) {
    await raw(adapter).rawQuery(
      `UPDATE app_schedule_policies SET enabled = ?, label = ?, tz = ?, updated_at = ? WHERE id = ?`,
      { params: [opts.enabled ? 1 : 0, opts.label ?? null, POLICY_TZ, now, id] },
    );
    await raw(adapter).rawQuery(`DELETE FROM app_schedule_rules WHERE policy_id = ?`, { params: [id] });
  } else {
    await raw(adapter).rawQuery(
      `INSERT INTO app_schedule_policies (id, target_type, target_id, enabled, tz, label, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      { params: [id, opts.targetType, opts.targetId, opts.enabled ? 1 : 0, POLICY_TZ, opts.label ?? null, opts.actor.userId ?? null, now, now] },
    );
  }
  for (const r of opts.rules) {
    await raw(adapter).rawQuery(
      `INSERT INTO app_schedule_rules (id, policy_id, weekday, time_min, action) VALUES (?, ?, ?, ?, ?)`,
      { params: ['rul_' + crypto.randomUUID(), id, r.weekday, r.time_min, r.action] },
    );
  }
  return (await getPolicy(adapter, opts.targetType, opts.targetId))!;
}

export async function setPolicyEnabled(adapter: HazoConnectAdapter, id: string, enabled: boolean): Promise<void> {
  await raw(adapter).rawQuery(
    `UPDATE app_schedule_policies SET enabled = ?, updated_at = ? WHERE id = ?`,
    { params: [enabled ? 1 : 0, new Date().toISOString(), id] },
  );
}

export async function deletePolicy(adapter: HazoConnectAdapter, id: string): Promise<void> {
  await raw(adapter).rawQuery(`DELETE FROM app_schedule_rules WHERE policy_id = ?`, { params: [id] });
  await raw(adapter).rawQuery(`DELETE FROM app_schedule_policies WHERE id = ?`, { params: [id] });
}

export async function clearOverrideForTarget(adapter: HazoConnectAdapter, targetType: 'device' | 'group', targetId: string): Promise<void> {
  if (targetType === 'device') {
    await raw(adapter).rawQuery(`UPDATE app_block_state SET override_until = NULL WHERE device_id = ?`, { params: [targetId] });
  } else {
    await raw(adapter).rawQuery(
      `UPDATE app_block_state SET override_until = NULL WHERE device_id IN (SELECT device_id FROM app_group_members WHERE group_id = ?)`,
      { params: [targetId] },
    );
  }
}

export async function applyPolicyNow(
  adapter: HazoConnectAdapter, provider: RouterProvider,
  targetType: 'device' | 'group', targetId: string, actor: { userId?: string | null },
): Promise<void> {
  const policy = await getPolicy(adapter, targetType, targetId);
  if (!policy || !policy.enabled || policy.rules.length === 0) return;
  const desired = policyState(policy.rules, Date.now(), policy.tz);
  if (!desired) return;
  const gate = { authorized: true, actorLabel: 'schedule', actorUserId: actor.userId ?? null };
  const action = desired === 'block' ? 'block' : 'unblock';
  if (targetType === 'device') await runBlockAction(adapter, provider, gate, targetId, action);
  else await runGroupBlockAction(adapter, provider, gate, targetId, action);
  await clearOverrideForTarget(adapter, targetType, targetId);
}
