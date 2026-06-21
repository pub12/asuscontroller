import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
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
} from '@/server/permissions/grantsService';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(
    os.tmpdir(),
    `netwarden_grants_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
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

    // ── create_grant_ok: createGrant inserts an active grant ─────────────────
    const grant = await createGrant(adapter, {
      subject: 'user@grants-test.local',
      capability: 'device.block',
      scopeType: 'global',
      scopeId: null,
      grantedBy: 'admin',
    });
    const create_grant_ok =
      grant.status === 'active' &&
      grant.subject === 'user@grants-test.local' &&
      grant.capability === 'device.block';

    // ── duplicate_idempotent_ok: same (subject, capability, scope) — no throw, no duplicate ──
    let duplicate_idempotent_ok = false;
    try {
      const grant2 = await createGrant(adapter, {
        subject: 'user@grants-test.local',
        capability: 'device.block',
        scopeType: 'global',
        scopeId: null,
        grantedBy: 'admin',
      });
      // Should succeed and return the same row (or reuse)
      const allGrants = await createCrudService(adapter, 'app_user_grants').findBy({
        subject: 'user@grants-test.local',
        capability: 'device.block',
      });
      duplicate_idempotent_ok =
        grant2.status === 'active' && allGrants.length === 1;
    } catch {
      duplicate_idempotent_ok = false;
    }

    // ── request_approve_creates_grant_ok ──────────────────────────────────────
    const request = await createRequest(adapter, {
      subject: 'requester@grants-test.local',
      capability: 'device.unblock',
      scopeType: 'group',
      scopeId: 'g1',
      note: 'please approve',
    });
    const approveResult = await approveRequest(adapter, request.id, 'admin');
    const request_approve_creates_grant_ok =
      approveResult !== null &&
      approveResult.request.status === 'approved' &&
      approveResult.grant.status === 'active' &&
      approveResult.grant.subject === 'requester@grants-test.local' &&
      approveResult.grant.capability === 'device.unblock';

    // ── decline_ok ────────────────────────────────────────────────────────────
    const request2 = await createRequest(adapter, {
      subject: 'requester2@grants-test.local',
      capability: 'group.block',
      scopeType: null,
      scopeId: null,
      note: 'decline me',
    });
    const declineResult = await declineRequest(adapter, request2.id, 'admin');
    // Confirm no grant was created for this subject
    const declinedGrants = await findActiveGrants(adapter, 'requester2@grants-test.local', 'group.block');
    const decline_ok =
      declineResult !== null &&
      declineResult.status === 'declined' &&
      declinedGrants.length === 0;

    // ── revoke_ok ─────────────────────────────────────────────────────────────
    const revokeGrant_ = await createGrant(adapter, {
      subject: 'revoke-user@grants-test.local',
      capability: 'schedule.create',
      scopeType: 'global',
      scopeId: null,
      grantedBy: 'admin',
    });
    await revokeGrant(adapter, revokeGrant_.id, 'admin');
    const afterRevoke = await findActiveGrants(adapter, 'revoke-user@grants-test.local', 'schedule.create');
    const revoke_ok = afterRevoke.length === 0;

    const all_ok =
      create_grant_ok &&
      duplicate_idempotent_ok &&
      request_approve_creates_grant_ok &&
      decline_ok &&
      revoke_ok;

    return Response.json({
      ok: true,
      all_ok,
      create_grant_ok,
      duplicate_idempotent_ok,
      request_approve_creates_grant_ok,
      decline_ok,
      revoke_ok,
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
