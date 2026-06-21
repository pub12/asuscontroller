/**
 * GET /api/block-api-test
 *
 * Tests the superadmin-gated block/unblock API action layer (runBlockAction)
 * against an isolated in-memory SQLite DB with a FakeRouterProvider.
 *
 * Asserts:
 *   - plain_denied_ok:   a non-superadmin user gets FORBIDDEN
 *   - block_ok:          superadmin can block an online device; fake state flips
 *   - idempotent_ok:     second block returns alreadyInState=true
 *   - unblock_ok:        superadmin can unblock; fake state flips back
 *   - offline_map_ok:    blocking an offline device maps to VALIDATION_FAILED
 *   - not_found_map_ok:  blocking unknown device maps to NOT_FOUND
 *   - all_ok:            all of the above
 */
import path from 'path';
import { readFileSync } from 'fs';
import { createTestDatabase, createTestUser } from 'hazo_testing';
import { createCrudService } from 'hazo_connect/server';
import { SUPERADMIN_PERMISSION } from '@/lib/app_config';
import { userHasSuperadmin } from '@/server/ensure_superadmin';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runBlockAction } from '@/server/devices/blockActions';

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

async function applyTestSchema(adapter: import('hazo_testing').AugmentedAdapter, hazoSchema: string) {
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

  const { adapter, teardown } = await createTestDatabase({
    mode: 'sqlite',
    migrations: [MIGRATIONS_DIR],
  });

  try {
    await applyTestSchema(adapter, hazoSchema);

    // 1. Create test users
    const superUser = await createTestUser(adapter, {
      email: 'super@block-api-test.local',
      role: 'role_superadmin_block_api',
      permissions: [SUPERADMIN_PERMISSION],
      scopeId: 'scope-superadmin-block-api',
    });

    const plainUser = await createTestUser(adapter, {
      email: 'plain@block-api-test.local',
      role: 'role_plain_block_api',
      permissions: ['netwarden:nw:user'],
      scopeId: 'scope-plain-block-api',
    });

    // 2. Resolve superadmin status
    const superSA = await userHasSuperadmin(adapter, superUser.id);
    const plainSA = await userHasSuperadmin(adapter, plainUser.id);

    // 3. Insert test devices
    await createCrudService(adapter, 'app_devices').insert({ id: 'd1', mac: 'AA:BB:CC:00:00:99', status: 'online' });
    await createCrudService(adapter, 'app_devices').insert({ id: 'd2', mac: 'AA:BB:CC:00:00:98', status: 'offline' });

    // 4. Create fake router provider
    const fake = new FakeRouterProvider();

    // Assertion: plain_denied_ok — non-superadmin gets FORBIDDEN
    const plainOutcome = await runBlockAction(
      adapter, fake,
      { isSuperadmin: plainSA, actorLabel: plainUser.email ?? 'plain' },
      'd1', 'block',
    );
    const plain_denied_ok = plainSA === false && plainOutcome.ok === false && plainOutcome.code === 'FORBIDDEN';

    // Assertion: block_ok — superadmin blocks online device
    const blockOutcome = await runBlockAction(
      adapter, fake,
      { isSuperadmin: superSA, actorLabel: superUser.email ?? 'super' },
      'd1', 'block',
    );
    const fakeBlockedAfterBlock = await fake.getBlockState('AA:BB:CC:00:00:99');
    const block_ok = superSA === true && blockOutcome.ok === true && blockOutcome.result.blocked === true && fakeBlockedAfterBlock === true;

    // Assertion: idempotent_ok — second block returns alreadyInState=true
    const idempotentOutcome = await runBlockAction(
      adapter, fake,
      { isSuperadmin: superSA, actorLabel: superUser.email ?? 'super' },
      'd1', 'block',
    );
    const idempotent_ok = idempotentOutcome.ok === true && idempotentOutcome.result.alreadyInState === true;

    // Assertion: unblock_ok — superadmin unblocks
    const unblockOutcome = await runBlockAction(
      adapter, fake,
      { isSuperadmin: superSA, actorLabel: superUser.email ?? 'super' },
      'd1', 'unblock',
    );
    const fakeBlockedAfterUnblock = await fake.getBlockState('AA:BB:CC:00:00:99');
    const unblock_ok = unblockOutcome.ok === true && unblockOutcome.result.blocked === false && fakeBlockedAfterUnblock === false;

    // Assertion: offline_map_ok — offline device maps to VALIDATION_FAILED
    const offlineOutcome = await runBlockAction(
      adapter, fake,
      { isSuperadmin: superSA, actorLabel: superUser.email ?? 'super' },
      'd2', 'block',
    );
    const offline_map_ok = offlineOutcome.ok === false && offlineOutcome.code === 'VALIDATION_FAILED';

    // Assertion: not_found_map_ok — unknown device maps to NOT_FOUND
    const notFoundOutcome = await runBlockAction(
      adapter, fake,
      { isSuperadmin: superSA, actorLabel: superUser.email ?? 'super' },
      'nope', 'block',
    );
    const not_found_map_ok = notFoundOutcome.ok === false && notFoundOutcome.code === 'NOT_FOUND';

    const all_ok = plain_denied_ok && block_ok && idempotent_ok && unblock_ok && offline_map_ok && not_found_map_ok;

    return { ok: true, all_ok, plain_denied_ok, block_ok, idempotent_ok, unblock_ok, offline_map_ok, not_found_map_ok };
  } finally {
    await teardown();
  }
}

export async function GET() {
  try {
    const result = await runTests();
    return Response.json(result);
  } catch (e) {
    console.error('[block-api-test]', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
