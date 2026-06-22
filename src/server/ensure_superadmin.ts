import 'server-only';

import type { HazoConnectAdapter } from 'hazo_connect';
import { createCrudService } from 'hazo_connect/server';
import { SUPERADMIN_PERMISSION } from '@/lib/app_config';

type PermRow = { id: string; permission_name: string };
type RoleRow = { id: string; role_name: string };
type ScopeRow = { id: string; name: string; level: string };

/**
 * Checks whether ANY user currently holds the superadmin permission
 * via the hazo_auth role/scope chain.
 */
async function hasSuperadminHolder(adapter: HazoConnectAdapter): Promise<boolean> {
  const sql = `
    SELECT 1 FROM hazo_user_scopes us
    JOIN hazo_role_permissions rp ON rp.role_id = us.role_id
    JOIN hazo_permissions p ON p.id = rp.permission_id
    WHERE p.permission_name = ?
    LIMIT 1
  `;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await adapter.rawQuery(sql, { params: [SUPERADMIN_PERMISSION] } as any);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Grants the superadmin permission to the given user via the role/scope tables.
 * Idempotent — safe to call multiple times.
 */
async function grantSuperadmin(adapter: HazoConnectAdapter, userId: string): Promise<void> {
  const roleName = 'darylweb_superadmin';
  const scopeName = 'DarylWeb Root';

  // Upsert permission
  const permSvc = createCrudService<PermRow>(adapter, 'hazo_permissions');
  let perm = await permSvc.findOneBy({ permission_name: SUPERADMIN_PERMISSION });
  if (!perm) {
    const rows = await permSvc.insert({
      id: crypto.randomUUID(),
      permission_name: SUPERADMIN_PERMISSION,
      description: 'DarylWeb superadmin',
    } as Partial<PermRow>);
    perm = rows[0];
  }

  // Upsert role
  const roleSvc = createCrudService<RoleRow>(adapter, 'hazo_roles');
  let role = await roleSvc.findOneBy({ role_name: roleName });
  if (!role) {
    const rows = await roleSvc.insert({ id: crypto.randomUUID(), role_name: roleName } as Partial<RoleRow>);
    role = rows[0];
  }

  // Upsert role_permission link (no id column — use rawQuery for INSERT OR IGNORE)
  const existingRp = await createCrudService(adapter, 'hazo_role_permissions').findBy({
    role_id: role.id,
    permission_id: perm.id,
  });
  if (!existingRp.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adapter.rawQuery(
      `INSERT OR IGNORE INTO hazo_role_permissions (role_id, permission_id) VALUES (?, ?)`,
      { params: [role.id, perm.id] } as any,
    );
  }

  // Upsert root scope
  const scopeSvc = createCrudService<ScopeRow>(adapter, 'hazo_scopes');
  let scope = await scopeSvc.findOneBy({ name: scopeName });
  if (!scope) {
    const rows = await scopeSvc.insert({
      id: crypto.randomUUID(),
      name: scopeName,
      level: 'firm',
    } as Partial<ScopeRow>);
    scope = rows[0];
  }

  // Upsert user_scope assignment (composite PK — use rawQuery for INSERT OR IGNORE)
  const existingUs = await createCrudService(adapter, 'hazo_user_scopes').findBy({
    user_id: userId,
    scope_id: scope.id,
  });
  if (!existingUs.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adapter.rawQuery(
      `INSERT OR IGNORE INTO hazo_user_scopes (user_id, scope_id, root_scope_id, role_id, status) VALUES (?, ?, ?, ?, 'ACTIVE')`,
      { params: [userId, scope.id, scope.id, role.id] } as any,
    );
  }
}

/**
 * Checks if the given user holds the superadmin permission.
 * Uses a raw JOIN query for reliability across adapters.
 */
async function userHasSuperadmin(adapter: HazoConnectAdapter, userId: string): Promise<boolean> {
  const sql = `
    SELECT 1 FROM hazo_user_scopes us
    JOIN hazo_role_permissions rp ON rp.role_id = us.role_id
    JOIN hazo_permissions p ON p.id = rp.permission_id
    WHERE us.user_id = ? AND p.permission_name = ?
    LIMIT 1
  `;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await adapter.rawQuery(sql, { params: [userId, SUPERADMIN_PERMISSION] } as any);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Login-time safety net: if NO user holds the superadmin permission yet,
 * and `email` matches SUPERADMIN_EMAIL env var, grant it to that user.
 * Idempotent; no-op for non-matching emails.
 */
export async function ensureFirstSuperadmin(
  adapter: HazoConnectAdapter,
  email: string,
): Promise<void> {
  const superadminEmail = process.env.SUPERADMIN_EMAIL;
  if (!superadminEmail || email !== superadminEmail) return;

  const alreadyHasHolder = await hasSuperadminHolder(adapter);
  if (alreadyHasHolder) return;

  // Find the user
  const userRows = await createCrudService(adapter, 'hazo_users').findBy({
    email_address: email,
  });
  if (!userRows.length) return;
  const userId = (userRows[0] as { id: string }).id;

  await grantSuperadmin(adapter, userId);
  console.log(`[ensureFirstSuperadmin] Granted ${SUPERADMIN_PERMISSION} to ${email}`);
}

/**
 * Per-user self-heal: if the env SUPERADMIN_EMAIL matches, and the user
 * doesn't currently hold the superadmin permission, grant it now.
 * Idempotent. Does nothing for non-matching emails.
 */
export async function ensureSuperadminByEmail(
  adapter: HazoConnectAdapter,
  email: string,
): Promise<void> {
  const superadminEmail = process.env.SUPERADMIN_EMAIL;
  if (!superadminEmail || email !== superadminEmail) return;

  const userRows = await createCrudService(adapter, 'hazo_users').findBy({
    email_address: email,
  });
  if (!userRows.length) return;
  const userId = (userRows[0] as { id: string }).id;

  if (await userHasSuperadmin(adapter, userId)) return;

  await grantSuperadmin(adapter, userId);
  console.log(`[ensureSuperadminByEmail] Granted ${SUPERADMIN_PERMISSION} to ${email}`);
}

/**
 * Exported for testing: checks whether a specific user holds the superadmin permission.
 */
export { userHasSuperadmin, hasSuperadminHolder };
