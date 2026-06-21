import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  createGrant,
  revokeGrant,
  findActiveGrants,
  createRequest,
  approveRequest,
  declineRequest,
  listRequests,
  filterVisibleRequests,
} from '@/server/permissions/grantsService';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_requests_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
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

    // ── submit_ok: createRequest inserts a pending request ───────────────────
    const req1 = await createRequest(adapter, {
      subject: 'alice@test.local',
      capability: 'device.block',
      scopeType: 'global',
      scopeId: null,
      note: 'please approve',
    });
    const submit_ok =
      req1.status === 'pending' &&
      req1.subject === 'alice@test.local' &&
      req1.capability === 'device.block';

    // ── approve_creates_grant_ok: approveRequest → grant + status approved ───
    const approveResult = await approveRequest(adapter, req1.id, 'admin');
    const activeGrantsAfterApprove = await findActiveGrants(
      adapter,
      'alice@test.local',
      'device.block',
    );
    const approve_creates_grant_ok =
      approveResult !== null &&
      approveResult.request.status === 'approved' &&
      approveResult.grant.status === 'active' &&
      activeGrantsAfterApprove.length > 0;

    // ── decline_ok: createRequest → declineRequest, no grant created ─────────
    const req2 = await createRequest(adapter, {
      subject: 'bob@test.local',
      capability: 'device.unblock',
      scopeType: 'global',
      scopeId: null,
      note: 'please decline me',
    });
    const declineResult = await declineRequest(adapter, req2.id, 'admin');
    const grantsAfterDecline = await findActiveGrants(adapter, 'bob@test.local', 'device.unblock');
    const decline_ok =
      declineResult !== null &&
      declineResult.status === 'declined' &&
      grantsAfterDecline.length === 0;

    // ── revoke_ok: createGrant then revokeGrant → no longer active ───────────
    const grantToRevoke = await createGrant(adapter, {
      subject: 'charlie@test.local',
      capability: 'schedule.create',
      scopeType: 'global',
      scopeId: null,
      grantedBy: 'admin',
    });
    await revokeGrant(adapter, grantToRevoke.id, 'admin');
    const grantsAfterRevoke = await findActiveGrants(
      adapter,
      'charlie@test.local',
      'schedule.create',
    );
    const revoke_ok = grantsAfterRevoke.length === 0;

    // ── filterVisibleRequests checks ─────────────────────────────────────────
    // Create additional requests for visibility testing
    await createRequest(adapter, {
      subject: 'alice@test.local',
      capability: 'device.unblock',
      scopeType: 'global',
      scopeId: null,
    });
    await createRequest(adapter, {
      subject: 'dave@test.local',
      capability: 'group.block',
      scopeType: 'global',
      scopeId: null,
    });

    const allRows = await listRequests(adapter);

    // ── superadmin_sees_all_ok ────────────────────────────────────────────────
    const superadminVisible = filterVisibleRequests(
      { subject: 'admin', isSuperadmin: true },
      allRows,
    );
    const superadmin_sees_all_ok = superadminVisible.length === allRows.length;

    // ── user_sees_own_ok ──────────────────────────────────────────────────────
    const aliceVisible = filterVisibleRequests(
      { subject: 'alice@test.local', isSuperadmin: false },
      allRows,
    );
    const user_sees_own_ok =
      aliceVisible.length > 0 &&
      aliceVisible.every((r) => r.subject === 'alice@test.local') &&
      !aliceVisible.some((r) => r.subject === 'dave@test.local');

    const all_ok =
      submit_ok &&
      approve_creates_grant_ok &&
      decline_ok &&
      revoke_ok &&
      superadmin_sees_all_ok &&
      user_sees_own_ok;

    return Response.json({
      ok: true,
      all_ok,
      submit_ok,
      approve_creates_grant_ok,
      decline_ok,
      revoke_ok,
      superadmin_sees_all_ok,
      user_sees_own_ok,
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
