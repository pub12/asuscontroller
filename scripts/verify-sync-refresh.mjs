// scripts/verify-sync-refresh.mjs — unit check for the offline-device capture
// and the 'pull' block reconcile (the manual Refresh path).
//
// Uses an in-memory SQLite DB (better-sqlite3) and an inline RouterProvider that
// returns a mix of online + offline clients and a controllable blocked-MAC set.
// ZERO real network calls. Proves:
//   - offline clients are persisted with status='offline' (not dropped),
//   - online clients are status='online',
//   - pull reconcile clears a stale is_blocked=1 when the router reports the
//     device unblocked (the exact "blocked badge won't clear" bug),
//   - pull reconcile sets is_blocked=1 for a device the router blocks directly,
//   - reapply mode does NOT clear a stale block (worker keeps app as truth).
//
// Run:  node --conditions=react-server --loader ./scripts/live-block-loader.mjs scripts/verify-sync-refresh.mjs
import Database from 'better-sqlite3';

const { runDeviceSync } = await import('../src/server/sync/runDeviceSync.ts');

// --- in-memory DB + adapter shim -------------------------------------------
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE app_devices (
    id TEXT PRIMARY KEY, mac TEXT, hostname TEXT, vendor TEXT, current_ip TEXT,
    last_band TEXT, status TEXT, is_new INTEGER, first_seen TEXT, last_seen TEXT,
    friendly_name TEXT, icon TEXT, notes TEXT, primary_group_id TEXT
  );
  CREATE TABLE app_block_state (
    device_id TEXT PRIMARY KEY REFERENCES app_devices(id),
    is_blocked INTEGER DEFAULT 0, blocked_by TEXT, blocked_at TEXT, reason TEXT,
    scheduled_unblock_at TEXT, unblock_job_id TEXT, router_synced INTEGER DEFAULT 0
  );
  CREATE TABLE app_device_presence (
    device_id TEXT, day TEXT, connected_minutes INTEGER,
    PRIMARY KEY (device_id, day)
  );
  CREATE TABLE hazo_audit_intent (
    id TEXT, correlation_id TEXT, event_name TEXT, payload TEXT,
    subject_kind TEXT, subject_id TEXT, actor_kind TEXT, occurred_at TEXT
  );
`);

const adapter = {
  async rawQuery(sql, options) {
    const params = options?.params ?? [];
    if (/^\s*select/i.test(sql)) return db.prepare(sql).all(...params);
    db.prepare(sql).run(...params);
    return [];
  },
};

// --- inline provider: 1 online (TV), 1 offline (iPhone) --------------------
const TV = 'AA:BB:CC:00:00:01';
const PHONE = 'AA:BB:CC:00:00:02';
let blockedMacs = [];
const provider = {
  async getClientList() {
    return [
      { mac: TV, ip: '192.168.50.101', name: 'Living-Room-TV', connected: true, band: '5G', vendor: 'Samsung' },
      { mac: PHONE, ip: '192.168.50.102', name: 'iPhone-15', connected: false, band: '', vendor: 'Apple' },
    ];
  },
  async setInternetAccess(mac, enabled) { blockedMacs = enabled ? blockedMacs.filter((m) => m !== mac) : [...new Set([...blockedMacs, mac])]; return { success: true, message: 'fake' }; },
  async getBlockState(mac) { return blockedMacs.includes(mac.toUpperCase()); },
  async getBlockedMacs() { return [...blockedMacs]; },
  capabilities() { return { getClientList: true, setInternetAccess: true, reboot: false }; },
};

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   ${extra ?? ''}`}`);
  if (!cond) failures++;
};
const dev = (mac) => db.prepare('SELECT * FROM app_devices WHERE mac = ?').get(mac);
const block = (mac) => db.prepare('SELECT b.* FROM app_block_state b JOIN app_devices d ON d.id = b.device_id WHERE d.mac = ?').get(mac);

// --- 1) initial pull sync persists online + offline ------------------------
await runDeviceSync(adapter, provider, '2026-06-21T00:00:00.000Z', { blockReconcile: 'pull' });
check('online client stored status=online', dev(TV)?.status === 'online', dev(TV)?.status);
check('offline client stored (not dropped)', dev(PHONE) != null);
check('offline client status=offline', dev(PHONE)?.status === 'offline', dev(PHONE)?.status);

// --- 2) THE BUG: app says blocked, router says unblocked -> pull clears it ---
db.prepare('INSERT INTO app_block_state (device_id, is_blocked, router_synced) VALUES (?, 1, 1)').run(dev(TV).id);
check('precondition: TV shows blocked', block(TV)?.is_blocked === 1);
blockedMacs = []; // router has NO blocks
const s2 = await runDeviceSync(adapter, provider, '2026-06-21T00:01:00.000Z', { blockReconcile: 'pull' });
check('pull cleared stale is_blocked -> 0', block(TV)?.is_blocked === 0, JSON.stringify(block(TV)));
check('pull counted the change', s2.block_pulled >= 1, String(s2.block_pulled));

// --- 3) router blocks a device directly -> pull creates is_blocked=1 --------
blockedMacs = [PHONE];
await runDeviceSync(adapter, provider, '2026-06-21T00:02:00.000Z', { blockReconcile: 'pull' });
check('pull set is_blocked=1 from router truth', block(PHONE)?.is_blocked === 1, JSON.stringify(block(PHONE)));

// --- 4) reapply mode does NOT clear a stale block (worker keeps app truth) ---
db.prepare('UPDATE app_block_state SET is_blocked = 1, router_synced = 1 WHERE device_id = ?').run(dev(TV).id);
blockedMacs = []; // router unblocked, but reapply should re-assert
const s4 = await runDeviceSync(adapter, provider, '2026-06-21T00:03:00.000Z', { blockReconcile: 'reapply' });
check('reapply kept is_blocked=1 (did not pull)', block(TV)?.is_blocked === 1);
check('reapply re-applied the block on router', blockedMacs.includes(TV), JSON.stringify(blockedMacs));
check('reapply counted reapplied', s4.reapplied >= 1, String(s4.reapplied));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
