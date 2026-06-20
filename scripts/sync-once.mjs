// scripts/sync-once.mjs — one-shot real-router device sync (plain Node).
//
// Logs into the live ASUS router, reads the connected client list, and runs the
// shared runDeviceSync against netwarden.sqlite. Plain Node (no 'server-only'):
// it builds its own RouterProvider-shaped object and imports only the
// server-only-free pure modules (runDeviceSync.ts, parseAsusClientList.ts).
//
// Usage:
//   node --env-file=.env.local scripts/sync-once.mjs           # sync (reconcile)
//   node --env-file=.env.local scripts/sync-once.mjs --reset   # wipe devices first
//
// --reset deletes ALL app_devices + app_device_presence rows before syncing —
// used once to clear the seeded fake devices. Omit it for normal re-syncs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DB_PATH = path.join(repoRoot, 'netwarden.sqlite');

const host = process.env.ROUTER_HOST;
const user = process.env.ROUTER_USER;
const pass = process.env.ROUTER_PASS;
if (!host || !user || !pass) {
  console.error('[sync-once] ROUTER_HOST/ROUTER_USER/ROUTER_PASS must be set (use --env-file=.env.local).');
  process.exit(1);
}

const ASUS_USER_AGENT = 'asusrouter-Android-DUTUtil-1.0.0.245';
const reset = process.argv.includes('--reset');

// --- DB adapter (rawQuery, { params }) over better-sqlite3 ---
const Database = (await import('better-sqlite3')).default;
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const adapter = {
  rawQuery(sql, options = {}) {
    const params = (options.params ?? []).map((v) =>
      v === undefined ? null : v === true ? 1 : v === false ? 0 : v,
    );
    try {
      const stmt = db.prepare(sql);
      if (stmt.reader) return Promise.resolve(stmt.all(...params));
      stmt.run(...params);
      return Promise.resolve([]);
    } catch (err) {
      return Promise.reject(err);
    }
  },
};

// --- Plain-Node RouterProvider for ASUS (login + getClientList only) ---
const { parseAsusClientList } = await import('../src/server/router/parseAsusClientList.ts');

const provider = {
  _token: null,
  async login() {
    const b64 = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await fetch(`http://${host}/login.cgi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': ASUS_USER_AGENT,
        Referer: `http://${host}/Main_Login.asp`,
      },
      body: new URLSearchParams({ login_authorization: b64 }).toString(),
    });
    if (!res.ok) throw new Error(`login.cgi HTTP ${res.status}`);
    const json = await res.json();
    if (typeof json.asus_token !== 'string') throw new Error('no asus_token in login response');
    this._token = json.asus_token;
  },
  isAuthenticated() {
    return !!this._token;
  },
  async getClientList() {
    if (!this._token) await this.login();
    const res = await fetch(`http://${host}/appGet.cgi?hook=get_clientlist()`, {
      headers: {
        Cookie: `asus_token=${this._token}`,
        'User-Agent': ASUS_USER_AGENT,
        Referer: `http://${host}/index.asp`,
      },
    });
    if (!res.ok) throw new Error(`appGet HTTP ${res.status}`);
    const text = await res.text();
    if (text.includes('Main_Login.asp')) {
      this._token = null;
      throw new Error('router returned login redirect — token rejected');
    }
    return parseAsusClientList(JSON.parse(text));
  },
};

// --- Run ---
console.log(`[sync-once] DB: ${DB_PATH}`);
console.log(`[sync-once] Router: ${user}@${host}${reset ? '  (RESET: wiping devices first)' : ''}`);

await provider.login();
console.log('[sync-once] Logged in.');

if (reset) {
  await adapter.rawQuery('DELETE FROM app_device_presence');
  const before = await adapter.rawQuery('SELECT COUNT(*) AS n FROM app_devices');
  await adapter.rawQuery('DELETE FROM app_devices');
  console.log(`[sync-once] Wiped ${before[0].n} existing device row(s) + presence.`);
}

const { runDeviceSync } = await import('../src/server/sync/runDeviceSync.ts');
const summary = await runDeviceSync(adapter, provider, new Date().toISOString(), { intervalSec: 60 });
console.log('[sync-once] Sync summary:', JSON.stringify(summary));

const total = await adapter.rawQuery('SELECT COUNT(*) AS n FROM app_devices');
console.log(`[sync-once] app_devices now has ${total[0].n} row(s).`);
db.close();
