import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { authorizeCapability } from '@/server/permissions/authorize';
import { createGrant } from '@/server/permissions/grantsService';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(
    os.tmpdir(),
    `darylweb_authorize_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: tmpDb,
        driver: 'better-sqlite3',
      },
    });

    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    // Insert test data
    await createCrudService(adapter, 'app_groups').insert({
      id: 'g1',
      name: 'Test Group',
    });
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd1',
      mac: 'AA:BB:CC:00:01:01',
      status: 'online',
    });
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd2',
      mac: 'AA:BB:CC:00:01:02',
      status: 'online',
    });
    // d1 is in g1; d2 is NOT in g1
    await createCrudService(adapter, 'app_group_members', {
      primaryKeys: ['group_id', 'device_id'],
      autoId: false,
    }).insert({ group_id: 'g1', device_id: 'd1', added_by: 'test', added_at: new Date().toISOString() });

    // ── superadmin_allow: superadmin allowed with no grant ────────────────────
    const superadminDecision = await authorizeCapability(
      adapter,
      { subject: null, isSuperadmin: true },
      'device.block',
      { deviceId: 'd1' },
    );
    const superadmin_allow = superadminDecision.allowed === true && superadminDecision.reason === 'superadmin';

    // ── global_grant_allow: non-superadmin with a global device.block grant ──
    await createGrant(adapter, {
      subject: 'global-user@test.local',
      capability: 'device.block',
      scopeType: 'global',
      scopeId: null,
      grantedBy: 'admin',
    });
    const globalGrantDecision = await authorizeCapability(
      adapter,
      { subject: 'global-user@test.local', isSuperadmin: false },
      'device.block',
      { deviceId: 'd2' }, // any device — global means all
    );
    const global_grant_allow = globalGrantDecision.allowed === true;

    // ── group_device_allow: user with device.block grant scoped to g1 allowed for d1 (member) ──
    await createGrant(adapter, {
      subject: 'group-user@test.local',
      capability: 'device.block',
      scopeType: 'group',
      scopeId: 'g1',
      grantedBy: 'admin',
    });
    const groupDeviceAllowDecision = await authorizeCapability(
      adapter,
      { subject: 'group-user@test.local', isSuperadmin: false },
      'device.block',
      { deviceId: 'd1' }, // d1 IS in g1
    );
    const group_device_allow = groupDeviceAllowDecision.allowed === true;

    // ── group_device_deny: same user denied for d2 (NOT in g1) ──────────────
    const groupDeviceDenyDecision = await authorizeCapability(
      adapter,
      { subject: 'group-user@test.local', isSuperadmin: false },
      'device.block',
      { deviceId: 'd2' }, // d2 is NOT in g1
    );
    const group_device_deny = groupDeviceDenyDecision.allowed === false;

    // ── group_action_allow: user with group.block grant scoped to g1 for group target ──
    await createGrant(adapter, {
      subject: 'group-action-user@test.local',
      capability: 'group.block',
      scopeType: 'group',
      scopeId: 'g1',
      grantedBy: 'admin',
    });
    const groupActionAllowDecision = await authorizeCapability(
      adapter,
      { subject: 'group-action-user@test.local', isSuperadmin: false },
      'group.block',
      { scopeType: 'group', scopeId: 'g1' },
    );
    const group_action_allow = groupActionAllowDecision.allowed === true;

    // ── no_grant_deny: user with no grants is denied ──────────────────────────
    const noGrantDecision = await authorizeCapability(
      adapter,
      { subject: 'nobody@test.local', isSuperadmin: false },
      'device.block',
      { deviceId: 'd1' },
    );
    const no_grant_deny = noGrantDecision.allowed === false;

    // ── deny_audited: after a deny, a hazo_audit_intent row with event_name='capability_checked'
    //    and payload decision 'deny' exists ─────────────────────────────────────
    const intentRows = await createCrudService(adapter, 'hazo_audit_intent').findBy({
      event_name: 'capability_checked',
    });
    const deny_audited = intentRows.some((row) => {
      const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
      return payload.includes('"decision":"deny"');
    });

    const all_ok =
      superadmin_allow &&
      global_grant_allow &&
      group_device_allow &&
      group_device_deny &&
      group_action_allow &&
      no_grant_deny &&
      deny_audited;

    return Response.json({
      ok: true,
      all_ok,
      superadmin_allow,
      global_grant_allow,
      group_device_allow,
      group_device_deny,
      group_action_allow,
      no_grant_deny,
      deny_audited,
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
