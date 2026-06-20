/**
 * GET /api/settings-gate-test
 *
 * Tests the superadmin gate logic used by the Settings page.
 * Uses hazo_testing against an isolated in-memory SQLite DB.
 *
 * Asserts:
 *   - a superadmin user is allowed (isSuperadmin === true)
 *   - a plain user is denied (isSuperadmin === false)
 */
import path from 'path';
import { readFileSync } from 'fs';
import { createTestDatabase, createTestUser } from 'hazo_testing';
import { SUPERADMIN_PERMISSION } from '@/lib/app_config';
import { userHasSuperadmin } from '@/server/ensure_superadmin';

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
  // createTestUser mints a session token (needs JWT_SECRET). This isolated-DB
  // autotest asserts the superadmin gate, not token signing, so provide a
  // throwaway secret when the environment hasn't set one (keeps it CI-safe).
  process.env.JWT_SECRET ??= 'netwarden-autotest-only-not-a-real-secret';

  const hazoSchema = getHazoAuthSchema();

  const { adapter, teardown } = await createTestDatabase({
    mode: 'sqlite',
    migrations: [MIGRATIONS_DIR],
  });

  try {
    await applyTestSchema(adapter, hazoSchema);

    // ── Test 1: superadmin user is allowed ───────────────────────────────────
    const superadminUser = await createTestUser(adapter, {
      email: 'superadmin@settings-test.local',
      role: 'role_superadmin_settings',
      permissions: [SUPERADMIN_PERMISSION],
      scopeId: 'scope-superadmin-settings',
    });
    const superadminHasPerm = await userHasSuperadmin(adapter, superadminUser.id);
    const superadmin_allowed_ok = superadminHasPerm === true;

    // ── Test 2: plain user is denied ─────────────────────────────────────────
    const plainUser = await createTestUser(adapter, {
      email: 'plain@settings-test.local',
      role: 'role_plain_settings',
      permissions: ['netwarden:nw:user'],
      scopeId: 'scope-plain-settings',
    });
    const plainHasPerm = await userHasSuperadmin(adapter, plainUser.id);
    const plain_user_denied_ok = plainHasPerm === false;

    return { ok: true, superadmin_allowed_ok, plain_user_denied_ok };
  } finally {
    await teardown();
  }
}

export async function GET() {
  try {
    const result = await runTests();
    return Response.json(result);
  } catch (e) {
    console.error('[settings-gate-test]', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
