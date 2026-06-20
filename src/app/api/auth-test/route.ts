/**
 * GET /api/auth-test
 *
 * Fetch-based contract check for auth role/permission resolution and
 * first-superadmin provisioning logic. Uses hazo_testing against an
 * isolated in-memory SQLite DB so the production DB is untouched.
 */
import path from 'path';
import { createTestDatabase } from 'hazo_testing';
import { createTestUser } from 'hazo_testing';
import { createCrudService } from 'hazo_connect/server';
import { SUPERADMIN_PERMISSION } from '@/lib/app_config';
import { ensureFirstSuperadmin, userHasSuperadmin } from '@/server/ensure_superadmin';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

// Resolve the hazo_auth canonical schema by reading the dist file directly.
// The package.json exports map does not expose this internal path, so we read
// the file and extract the schema string.
import { readFileSync } from 'fs';

function getHazoAuthSchema(): string {
  const filePath = path.join(process.cwd(), 'node_modules/hazo_auth/dist/lib/schema/sqlite_schema.js');
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(/export const SQLITE_SCHEMA = `([\s\S]*?)`;/);
  if (!match) throw new Error('Could not parse SQLITE_SCHEMA from hazo_auth dist');
  return match[1];
}

// hazo_testing's createTestUser uses hazo_user_roles (direct user→role junction)
// in addition to hazo_user_scopes. This table is not in the canonical hazo_auth
// schema (which uses hazo_user_scopes.role_id instead), so we create it here
// for test compatibility.
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
  // Create hazo_user_roles for createTestUser compatibility
  try {
    await adapter.rawQuery(HAZO_USER_ROLES_DDL.trim(), {} as RequestInit);
  } catch {
    // ignore
  }
}

async function runTests() {
  const hazoSchema = getHazoAuthSchema();

  // Create isolated in-memory DB with both app migrations and hazo_auth schema
  const { adapter, teardown } = await createTestDatabase({
    mode: 'sqlite',
    migrations: [MIGRATIONS_DIR],
  });

  try {
    await applyTestSchema(adapter, hazoSchema);

    // ── Test 1: superadmin user resolves as superadmin ────────────────────────
    const superadminUser = await createTestUser(adapter, {
      email: 'superadmin@test.local',
      role: 'role_superadmin_test',
      permissions: [SUPERADMIN_PERMISSION],
      scopeId: 'scope-superadmin-test',
    });

    const superadminHasPerm = await userHasSuperadmin(adapter, superadminUser.id);
    const superadmin_resolves_ok = superadminHasPerm === true;

    // ── Test 2: plain user does NOT have superadmin permission ────────────────
    const plainUser = await createTestUser(adapter, {
      email: 'plain@test.local',
      role: 'role_plain_test',
      permissions: ['netwarden:nw:user'],
      scopeId: 'scope-plain-test',
    });

    const plainHasPerm = await userHasSuperadmin(adapter, plainUser.id);
    const plain_user_not_superadmin_ok = plainHasPerm === false;

    // ── Test 3 & 4: ensureFirstSuperadmin grant + idempotency ─────────────────
    const targetEmail = 'first-admin@test.local';
    // Override env var for the test
    const originalEnv = process.env.SUPERADMIN_EMAIL;
    process.env.SUPERADMIN_EMAIL = targetEmail;

    // Tests 3-5 use a fresh isolated DB so hasSuperadminHolder starts with zero holders,
    // cleanly testing the "no holder → grant" path without interference from Test 1.
    const { adapter: freshAdapter, teardown: freshTeardown } = await createTestDatabase({
      mode: 'sqlite',
    });

    try {
      await applyTestSchema(freshAdapter, hazoSchema);

      // Create target user in fresh DB
      const freshTargetUser = await createTestUser(freshAdapter, { email: targetEmail });

      // First call: no holder exists → should grant
      await ensureFirstSuperadmin(freshAdapter, targetEmail);
      const afterFirstGrant = await userHasSuperadmin(freshAdapter, freshTargetUser.id);
      const first_superadmin_grant_ok = afterFirstGrant === true;

      // Second call: holder already exists → should be no-op (no error, no duplicate)
      await ensureFirstSuperadmin(freshAdapter, targetEmail);
      const afterSecondGrant = await userHasSuperadmin(freshAdapter, freshTargetUser.id);
      // Check no duplicate user_scope rows
      const scopeRows = await createCrudService(freshAdapter, 'hazo_user_scopes').findBy({
        user_id: freshTargetUser.id,
      });
      const idempotent_ok = afterSecondGrant === true && scopeRows.length === 1;

      // ── Test 5: non-matching email is a no-op ────────────────────────────────
      const nonMatchingEmail = 'other@test.local';
      const otherUser = await createTestUser(freshAdapter, { email: nonMatchingEmail });
      await ensureFirstSuperadmin(freshAdapter, nonMatchingEmail);
      const otherHasPerm = await userHasSuperadmin(freshAdapter, otherUser.id);
      const non_matching_noop_ok = otherHasPerm === false;

      // Restore env
      if (originalEnv === undefined) {
        delete process.env.SUPERADMIN_EMAIL;
      } else {
        process.env.SUPERADMIN_EMAIL = originalEnv;
      }

      return {
        ok: true,
        superadmin_resolves_ok,
        plain_user_not_superadmin_ok,
        first_superadmin_grant_ok,
        idempotent_ok,
        non_matching_noop_ok,
      };
    } finally {
      // Restore env on any error path
      if (originalEnv === undefined) {
        delete process.env.SUPERADMIN_EMAIL;
      } else {
        process.env.SUPERADMIN_EMAIL = originalEnv;
      }
      await freshTeardown();
    }
  } finally {
    await teardown();
  }
}

export async function GET() {
  try {
    const result = await runTests();
    return Response.json(result);
  } catch (e) {
    console.error('[auth-test]', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
