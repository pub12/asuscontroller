import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const DB_PATH = path.join(projectRoot, 'netwarden.sqlite');

// ── 1. App migrations (hazo_connect) ─────────────────────────────────────────
try {
  const adapter = createHazoConnect({
    type: 'sqlite',
    sqlite: {
      database_path: DB_PATH,
      driver: 'better-sqlite3',
    },
  });

  const applied = await runMigrations(adapter, {
    directory: path.join(projectRoot, 'migrations'),
  });

  console.log(`[seed] app migrations applied: ${applied.length}`);
  for (const m of applied) {
    console.log(`  - ${m.name}`);
  }
} catch (err) {
  console.error('[seed] App migration failed:', err);
  process.exit(1);
}

// ── 2. hazo_auth SQLite schema (from package — idempotent via IF NOT EXISTS) ──
const { default: Database } = await import('better-sqlite3');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Import the canonical schema from the published package.
// The dist file uses ESM 'export const' — we read it directly since the
// package.json exports map doesn't expose this internal dist path.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Use require after converting the ESM file content via readFileSync + eval trick —
// simpler: just read the file and capture the schema string via regex.
import { readFileSync } from 'fs';
const schemaFileRaw = readFileSync(
  new URL('../node_modules/hazo_auth/dist/lib/schema/sqlite_schema.js', import.meta.url),
  'utf8'
);
// Extract the SQL string from: export const SQLITE_SCHEMA = `...`;
const schemaMatch = schemaFileRaw.match(/export const SQLITE_SCHEMA = `([\s\S]*?)`;/);
if (!schemaMatch) throw new Error('[seed] Could not parse SQLITE_SCHEMA from hazo_auth');
const SQLITE_SCHEMA = schemaMatch[1];

for (const stmt of SQLITE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
  try {
    db.prepare(stmt).run();
  } catch {
    // ignore: table/index already exists, PRAGMA returning, etc.
  }
}
console.log('[seed] hazo_auth schema applied (idempotent).');

// ── 3. First-superadmin provisioning ─────────────────────────────────────────
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? 'changeme1234';
const SUPERADMIN_PERMISSION = 'netwarden:nw:superadmin';

if (SUPERADMIN_EMAIL) {
  const { default: argon2 } = await import('argon2');

  const passwordHash = await argon2.hash(SUPERADMIN_PASSWORD);

  // Upsert user (delete + reinsert to refresh password hash; FK cascade clears scope rows)
  const existing = db.prepare('SELECT id FROM hazo_users WHERE email_address = ?').get(SUPERADMIN_EMAIL);
  let userId;
  if (existing) {
    userId = existing.id;
    // Refresh password hash and ensure ACTIVE + email_verified
    db.prepare(`UPDATE hazo_users SET password_hash = ?, status = 'ACTIVE', email_verified = 1 WHERE id = ?`)
      .run(passwordHash, userId);
    console.log(`[seed] Updated existing superadmin user: ${SUPERADMIN_EMAIL}`);
  } else {
    userId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO hazo_users (id, email_address, name, password_hash, status, email_verified)
      VALUES (?, ?, 'SuperAdmin', ?, 'ACTIVE', 1)
    `).run(userId, SUPERADMIN_EMAIL, passwordHash);
    console.log(`[seed] Created superadmin user: ${SUPERADMIN_EMAIL}`);
  }

  // Idempotent permission
  const permId = crypto.randomUUID();
  db.prepare(`INSERT OR IGNORE INTO hazo_permissions (id, permission_name, description)
              VALUES (?, ?, 'NetWarden superadmin')`)
    .run(permId, SUPERADMIN_PERMISSION);
  const actualPermId = db.prepare(`SELECT id FROM hazo_permissions WHERE permission_name = ?`)
    .get(SUPERADMIN_PERMISSION).id;

  // Idempotent role
  const roleId = crypto.randomUUID();
  db.prepare(`INSERT OR IGNORE INTO hazo_roles (id, role_name) VALUES (?, 'netwarden_superadmin')`)
    .run(roleId);
  const actualRoleId = db.prepare(`SELECT id FROM hazo_roles WHERE role_name = 'netwarden_superadmin'`)
    .get().id;

  // Idempotent role_permission link
  db.prepare(`INSERT OR IGNORE INTO hazo_role_permissions (role_id, permission_id) VALUES (?, ?)`)
    .run(actualRoleId, actualPermId);

  // Idempotent root scope
  const scopeId = crypto.randomUUID();
  db.prepare(`INSERT OR IGNORE INTO hazo_scopes (id, name, level) VALUES (?, 'NetWarden Root', 'firm')`)
    .run(scopeId);
  const actualScopeId = db.prepare(`SELECT id FROM hazo_scopes WHERE name = 'NetWarden Root'`)
    .get().id;

  // Idempotent user_scope assignment
  db.prepare(`
    INSERT OR IGNORE INTO hazo_user_scopes (user_id, scope_id, root_scope_id, role_id, status)
    VALUES (?, ?, ?, ?, 'ACTIVE')
  `).run(userId, actualScopeId, actualScopeId, actualRoleId);

  console.log(`[seed] Superadmin granted: ${SUPERADMIN_EMAIL} / permission: ${SUPERADMIN_PERMISSION}`);
  console.log(`[seed] Login credentials: ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}`);
} else {
  console.log('[seed] SUPERADMIN_EMAIL not set — skipping first-superadmin provisioning.');
  console.log('[seed] Set SUPERADMIN_EMAIL (and optionally SUPERADMIN_PASSWORD) in .env to create the superadmin user.');
}

db.close();
