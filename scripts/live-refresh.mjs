// scripts/live-refresh.mjs — run exactly what the "Refresh" button does, against
// the REAL router + REAL netwarden.sqlite. Read-only on the router (device sync
// getClientList + getBlockedMacs); writes only the local DB (captures offline
// devices, mirrors live block state). Never calls setInternetAccess.
//
//   node --conditions=react-server --loader ./scripts/live-block-loader.mjs --env-file=.env.local scripts/live-refresh.mjs
import Database from 'better-sqlite3';

const { AsusWrtProvider } = await import('../src/server/router/AsusWrtProvider.ts');
const { runDeviceSync } = await import('../src/server/sync/runDeviceSync.ts');

const db = new Database('netwarden.sqlite');
const adapter = {
  async rawQuery(sql, options) {
    const params = options?.params ?? [];
    if (/^\s*select/i.test(sql)) return db.prepare(sql).all(...params);
    db.prepare(sql).run(...params);
    return [];
  },
};

const before = db.prepare('SELECT COUNT(*) c FROM app_devices').get().c;
const blockedBefore = db.prepare('SELECT COUNT(*) c FROM app_block_state WHERE is_blocked = 1').get().c;
console.log(`before: ${before} devices, ${blockedBefore} blocked`);

const summary = await runDeviceSync(
  adapter, new AsusWrtProvider(), new Date().toISOString(),
  { blockReconcile: 'pull' },
);
console.log('summary:', JSON.stringify(summary));

const after = db.prepare('SELECT COUNT(*) c FROM app_devices').get().c;
const online = db.prepare("SELECT COUNT(*) c FROM app_devices WHERE status='online'").get().c;
const blockedAfter = db.prepare('SELECT COUNT(*) c FROM app_block_state WHERE is_blocked = 1').get().c;
console.log(`after:  ${after} devices (${online} online, ${after - online} offline), ${blockedAfter} blocked`);
