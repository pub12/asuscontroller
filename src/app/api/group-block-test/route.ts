/**
 * GET /api/group-block-test
 *
 * Hermetic autotest for runGroupBlockAction.
 *
 * Checks:
 *   all_offline_skipped_ok: group whose members are ALL offline → block →
 *     affected empty, skippedOffline = all members, failures empty, isBlocked false.
 *   partial_block_ok: group with 2 online + 1 offline → block →
 *     affected.length===2, skippedOffline.length===1, failures empty, isBlocked false.
 *   all_online_blocked_ok: group all-online → block →
 *     affected.length===memberCount, skippedOffline empty, isBlocked true.
 *   failure_captured_ok: group with an ORPHAN member (device_id in app_group_members
 *     but no app_devices row) + one online device → block →
 *     orphan in failures (NOT_FOUND), online device in affected.
 *   unblock_ok: take the all-online group, block it, then unblock →
 *     affected.length===memberCount, isBlocked false.
 *   missing_group_ok: runGroupBlockAction(..., 'nonexistent-id', 'block') →
 *     { ok:false, code:'NOT_FOUND' }.
 *   authorize_group_scope_ok: authorizeCapability with no grant → allowed false;
 *     createGrant then re-check → allowed true.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { readFileSync } from 'fs';
import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runGroupBlockAction } from '@/server/groups/groupBlockActions';
import { authorizeCapability } from '@/server/permissions/authorize';
import { createGrant } from '@/server/permissions/grantsService';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

function getHazoAuthSchema(): string {
  const filePath = path.join(process.cwd(), 'node_modules/hazo_auth/dist/lib/schema/sqlite_schema.js');
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(/export const SQLITE_SCHEMA = `([\s\S]*?)`;/);
  if (!match) throw new Error('Could not parse SQLITE_SCHEMA from hazo_auth dist');
  return match[1];
}

const HAZO_USER_ROLES_DDL = `
  CREATE TABLE IF NOT EXISTS hazo_user_roles (
    user_id TEXT NOT NULL REFERENCES hazo_users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES hazo_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  )
`;

async function applyTestSchema(adapter: Awaited<ReturnType<typeof createHazoConnect>>, hazoSchema: string) {
  for (const stmt of hazoSchema.split(';').map((s) => s.trim()).filter(Boolean)) {
    try {
      await adapter.rawQuery(stmt, {} as RequestInit);
    } catch {
      // ignore already-exists errors
    }
  }
  try {
    await adapter.rawQuery(HAZO_USER_ROLES_DDL.trim(), {} as RequestInit);
  } catch {
    // ignore
  }
}

async function runTests() {
  process.env.JWT_SECRET ??= 'netwarden-autotest-only-not-a-real-secret';

  const hazoSchema = getHazoAuthSchema();

  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_group_block_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  const adapter = createHazoConnect({
    type: 'sqlite',
    sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
  });

  try {
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });
    await applyTestSchema(adapter, hazoSchema);

    const nowIso = new Date().toISOString();
    const deviceSvc = createCrudService<Record<string, unknown>>(adapter, 'app_devices');
    const groupSvc = createCrudService<Record<string, unknown>>(adapter, 'app_groups');
    const memberSvc = createCrudService<Record<string, unknown>>(adapter, 'app_group_members', {
      primaryKeys: ['group_id', 'device_id'],
      autoId: false,
    });

    const gate = { authorized: true, actorLabel: 'tester', actorUserId: 'tester' };
    const fake = new FakeRouterProvider();

    // ── Seed devices ──────────────────────────────────────────────────────────
    // Online devices
    await deviceSvc.insert({ id: 'online1', mac: 'AA:BB:CC:00:01:01', status: 'online', last_seen: nowIso });
    await deviceSvc.insert({ id: 'online2', mac: 'AA:BB:CC:00:01:02', status: 'online', last_seen: nowIso });
    await deviceSvc.insert({ id: 'online3', mac: 'AA:BB:CC:00:01:03', status: 'online', last_seen: nowIso });
    // Offline devices
    await deviceSvc.insert({ id: 'offline1', mac: 'AA:BB:CC:00:02:01', status: 'offline', last_seen: nowIso });
    await deviceSvc.insert({ id: 'offline2', mac: 'AA:BB:CC:00:02:02', status: 'offline', last_seen: nowIso });
    await deviceSvc.insert({ id: 'offline3', mac: 'AA:BB:CC:00:02:03', status: 'offline', last_seen: nowIso });

    // ── Seed groups ───────────────────────────────────────────────────────────
    const groupAllOffline = { id: 'g-all-offline', name: 'All Offline', type: 'generic', created_at: nowIso };
    const groupPartial = { id: 'g-partial', name: 'Partial', type: 'generic', created_at: nowIso };
    const groupAllOnline = { id: 'g-all-online', name: 'All Online', type: 'generic', created_at: nowIso };
    const groupOrphan = { id: 'g-orphan', name: 'Orphan', type: 'generic', created_at: nowIso };

    await groupSvc.insert(groupAllOffline);
    await groupSvc.insert(groupPartial);
    await groupSvc.insert(groupAllOnline);
    await groupSvc.insert(groupOrphan);

    // All-offline group: offline1, offline2, offline3
    await memberSvc.insert({ group_id: 'g-all-offline', device_id: 'offline1', added_at: nowIso });
    await memberSvc.insert({ group_id: 'g-all-offline', device_id: 'offline2', added_at: nowIso });
    await memberSvc.insert({ group_id: 'g-all-offline', device_id: 'offline3', added_at: nowIso });

    // Partial group: online1, online2, offline1
    await memberSvc.insert({ group_id: 'g-partial', device_id: 'online1', added_at: nowIso });
    await memberSvc.insert({ group_id: 'g-partial', device_id: 'online2', added_at: nowIso });
    await memberSvc.insert({ group_id: 'g-partial', device_id: 'offline1', added_at: nowIso });

    // All-online group: online1, online2, online3
    await memberSvc.insert({ group_id: 'g-all-online', device_id: 'online1', added_at: nowIso });
    await memberSvc.insert({ group_id: 'g-all-online', device_id: 'online2', added_at: nowIso });
    await memberSvc.insert({ group_id: 'g-all-online', device_id: 'online3', added_at: nowIso });

    // Orphan group: orphan-device (no app_devices row) + online1
    // Disable FK constraints temporarily to insert the orphan member row
    await adapter.rawQuery('PRAGMA foreign_keys = OFF', {} as RequestInit);
    await memberSvc.insert({ group_id: 'g-orphan', device_id: 'orphan-device', added_at: nowIso });
    await adapter.rawQuery('PRAGMA foreign_keys = ON', {} as RequestInit);
    await memberSvc.insert({ group_id: 'g-orphan', device_id: 'online1', added_at: nowIso });

    // ── Test: all_offline_skipped_ok ─────────────────────────────────────────
    const allOfflineOutcome = await runGroupBlockAction(adapter, fake, gate, 'g-all-offline', 'block');
    const all_offline_skipped_ok =
      allOfflineOutcome.ok === true &&
      allOfflineOutcome.summary.affected.length === 0 &&
      allOfflineOutcome.summary.skippedOffline.length === 3 &&
      allOfflineOutcome.summary.failures.length === 0 &&
      allOfflineOutcome.summary.isBlocked === false;

    // ── Test: partial_block_ok ────────────────────────────────────────────────
    const partialOutcome = await runGroupBlockAction(adapter, fake, gate, 'g-partial', 'block');
    const partial_block_ok =
      partialOutcome.ok === true &&
      partialOutcome.summary.affected.length === 2 &&
      partialOutcome.summary.skippedOffline.length === 1 &&
      partialOutcome.summary.failures.length === 0 &&
      partialOutcome.summary.isBlocked === false; // offline member not blocked → not all-blocked

    // ── Test: all_online_blocked_ok ──────────────────────────────────────────
    const allOnlineOutcome = await runGroupBlockAction(adapter, fake, gate, 'g-all-online', 'block');
    const all_online_blocked_ok =
      allOnlineOutcome.ok === true &&
      allOnlineOutcome.summary.affected.length === 3 &&
      allOnlineOutcome.summary.skippedOffline.length === 0 &&
      allOnlineOutcome.summary.failures.length === 0 &&
      allOnlineOutcome.summary.isBlocked === true;

    // ── Test: failure_captured_ok ─────────────────────────────────────────────
    const orphanOutcome = await runGroupBlockAction(adapter, fake, gate, 'g-orphan', 'block');
    const failure_captured_ok =
      orphanOutcome.ok === true &&
      orphanOutcome.summary.failures.some((f) => f.deviceId === 'orphan-device') &&
      orphanOutcome.summary.affected.some((id) => id === 'online1') &&
      orphanOutcome.summary.failures.length === 1 &&
      orphanOutcome.summary.affected.length === 1;

    // ── Test: unblock_ok ──────────────────────────────────────────────────────
    // all-online group is already blocked from the previous test
    const unblockOutcome = await runGroupBlockAction(adapter, fake, gate, 'g-all-online', 'unblock');
    const unblock_ok =
      unblockOutcome.ok === true &&
      unblockOutcome.summary.affected.length === 3 &&
      unblockOutcome.summary.isBlocked === false;

    // ── Test: missing_group_ok ────────────────────────────────────────────────
    const missingOutcome = await runGroupBlockAction(adapter, fake, gate, 'nonexistent-id', 'block');
    const missing_group_ok = missingOutcome.ok === false && missingOutcome.code === 'NOT_FOUND';

    // ── Test: authorize_group_scope_ok ────────────────────────────────────────
    const denyDecision = await authorizeCapability(
      adapter,
      { subject: 'u1', isSuperadmin: false },
      'group.block',
      { scopeType: 'group', scopeId: 'g-all-online' },
    );
    await createGrant(adapter, {
      subject: 'u1',
      capability: 'group.block',
      scopeType: 'group',
      scopeId: 'g-all-online',
      grantedBy: 'admin',
    });
    const allowDecision = await authorizeCapability(
      adapter,
      { subject: 'u1', isSuperadmin: false },
      'group.block',
      { scopeType: 'group', scopeId: 'g-all-online' },
    );
    const authorize_group_scope_ok = denyDecision.allowed === false && allowDecision.allowed === true;

    const all_ok =
      all_offline_skipped_ok &&
      partial_block_ok &&
      all_online_blocked_ok &&
      failure_captured_ok &&
      unblock_ok &&
      missing_group_ok &&
      authorize_group_scope_ok;

    return {
      ok: true,
      all_ok,
      all_offline_skipped_ok,
      partial_block_ok,
      all_online_blocked_ok,
      failure_captured_ok,
      unblock_ok,
      missing_group_ok,
      authorize_group_scope_ok,
    };
  } finally {
    try {
      fs.unlinkSync(tmpDb);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function GET() {
  try {
    const result = await runTests();
    return Response.json(result);
  } catch (e) {
    console.error('[group-block-test]', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
