/**
 * promote-superadmin.mjs
 *
 * Idempotent CLI script to grant the superadmin permission to a user by email.
 * Uses direct better-sqlite3 — no TypeScript compilation required.
 *
 * Usage:
 *   node scripts/promote-superadmin.mjs user@example.com
 *
 * Env:
 *   DB_PATH — override the SQLite database path (default: <project-root>/darylweb.sqlite)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const EMAIL = process.argv[2];
if (!EMAIL) {
  console.error('Usage: node scripts/promote-superadmin.mjs <email>');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH ?? path.join(projectRoot, 'darylweb.sqlite');

const SUPERADMIN_PERMISSION = 'darylweb:nw:superadmin';
const ROLE_NAME = 'darylweb_superadmin';
const SCOPE_NAME = 'DarylWeb Root';

const { default: Database } = await import('better-sqlite3');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Look up user
const user = db.prepare('SELECT id FROM hazo_users WHERE email_address = ?').get(EMAIL);
if (!user) {
  console.error(`[promote-superadmin] No user found with email: ${EMAIL}`);
  process.exit(1);
}
const userId = user.id;

// 2. Check if already has superadmin
const existing = db.prepare(`
  SELECT 1 FROM hazo_user_scopes us
  JOIN hazo_role_permissions rp ON rp.role_id = us.role_id
  JOIN hazo_permissions p ON p.id = rp.permission_id
  WHERE us.user_id = ? AND p.permission_name = ?
  LIMIT 1
`).get(userId, SUPERADMIN_PERMISSION);

if (existing) {
  console.log(`[promote-superadmin] ${EMAIL} already has superadmin. Nothing to do.`);
  process.exit(0);
}

// 3. Upsert permission
const permId = crypto.randomUUID();
db.prepare(`INSERT OR IGNORE INTO hazo_permissions (id, permission_name, description) VALUES (?, ?, 'DarylWeb superadmin')`)
  .run(permId, SUPERADMIN_PERMISSION);
const actualPermId = db.prepare('SELECT id FROM hazo_permissions WHERE permission_name = ?')
  .get(SUPERADMIN_PERMISSION).id;

// 4. Upsert role
const roleId = crypto.randomUUID();
db.prepare(`INSERT OR IGNORE INTO hazo_roles (id, role_name) VALUES (?, ?)`)
  .run(roleId, ROLE_NAME);
const actualRoleId = db.prepare('SELECT id FROM hazo_roles WHERE role_name = ?')
  .get(ROLE_NAME).id;

// 5. Upsert role_permission link
db.prepare(`INSERT OR IGNORE INTO hazo_role_permissions (role_id, permission_id) VALUES (?, ?)`)
  .run(actualRoleId, actualPermId);

// 6. Upsert root scope
const scopeId = crypto.randomUUID();
db.prepare(`INSERT OR IGNORE INTO hazo_scopes (id, name, level) VALUES (?, ?, 'firm')`)
  .run(scopeId, SCOPE_NAME);
const actualScopeId = db.prepare('SELECT id FROM hazo_scopes WHERE name = ?')
  .get(SCOPE_NAME).id;

// 7. Upsert user_scope assignment
db.prepare(`
  INSERT OR IGNORE INTO hazo_user_scopes (user_id, scope_id, root_scope_id, role_id, status)
  VALUES (?, ?, ?, ?, 'ACTIVE')
`).run(userId, actualScopeId, actualScopeId, actualRoleId);

db.close();

console.log(`[promote-superadmin] Granted ${SUPERADMIN_PERMISSION} to ${EMAIL}`);
