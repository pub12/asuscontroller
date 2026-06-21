// scripts/live-block-test.mjs — Phase 8 LIVE TEST (the ONLY real-network step of the build).
//
// What it does: blocks internet for ONE pinned device, gives you a window to verify the
// tablet actually lost internet, then ALWAYS restores access.
//
// ── Safety guardrails ────────────────────────────────────────────────────────
//   • Target MAC is PINNED to DC:BD:7A:D6:2F:02 (Tablet-kitchen) and CANNOT be
//     overridden by any argument or env var. The script will only ever touch this MAC.
//   • A real run requires BOTH  ROUTER_PROVIDER=asus  AND  LIVE_CONFIRM=1.
//   • Fail-safe (three layers, all restore access):
//       1. The happy path auto-restores after LIVE_VERIFY_SECONDS (default 45s).
//       2. A watchdog force-restores + exits if anything hangs (default 5 min).
//       3. SIGINT/SIGTERM (Ctrl-C) restore access before exiting.
//   • If the target is offline / absent from the client list, the script SKIPS
//     (logs and exits 0) without touching the router.
//
// ── Dry-run (safe, no network — use this to inspect behaviour) ────────────────
//     LIVE_SIMULATE=1 LIVE_VERIFY_SECONDS=1 node scripts/live-block-test.mjs
//   Variants:  LIVE_SIM_OFFLINE=1 (target offline → skip),
//              LIVE_WATCHDOG_MS=1500 LIVE_VERIFY_SECONDS=100 (exercise watchdog).
//
// ── LIVE fire (real router — run this yourself while watching the tablet) ──────
//     ROUTER_PROVIDER=asus LIVE_CONFIRM=1 \
//       node --conditions=react-server --loader ./scripts/live-block-loader.mjs \
//       scripts/live-block-test.mjs
//   (Router credentials must be available the same way the app uses them:
//    ROUTER_HOST / ROUTER_USER / ROUTER_PASS, or your configured secrets.)
//   The --conditions/--loader flags let it reuse the app's real, tested
//   AsusWrtProvider (src/server/router) rather than a hand-copied mirror.

const TARGET_MAC = 'DC:BD:7A:D6:2F:02'; // PINNED — do not parameterise.
const TARGET_LABEL = 'Tablet-kitchen';

const SIMULATE = process.env.LIVE_SIMULATE === '1';
const VERIFY_SECONDS = clampInt(process.env.LIVE_VERIFY_SECONDS, 45, 1, 3600);
const WATCHDOG_MS = clampInt(process.env.LIVE_WATCHDOG_MS, 300_000, 1_000, 600_000);

const log = (...a) => console.log('[live-block]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clampInt(raw, dflt, min, max) {
  const n = raw == null ? dflt : Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// ── In-script fake provider (SIMULATE only) ──────────────────────────────────
// Deliberately independent of FakeRouterProvider so the dry-run is a pure test of
// THIS script's orchestration, guards, and fail-safe — with the target guaranteed present.
function makeFakeProvider({ present }) {
  let blocked = false;
  const calls = [];
  return {
    _state: () => ({ blocked, calls: [...calls] }),
    async login() { calls.push('login'); },
    async getClientList() {
      calls.push('getClientList');
      return present
        ? [{ mac: TARGET_MAC, ip: '10.0.0.42', name: TARGET_LABEL, connected: true, band: '5G' }]
        : [];
    },
    async getBlockState() { calls.push('getBlockState'); return blocked; },
    async setInternetAccess(mac, enabled) {
      calls.push(`set:${mac}:${enabled ? 'on' : 'off'}`);
      if (mac !== TARGET_MAC) return { success: false, message: `REFUSED non-target MAC ${mac}` };
      blocked = !enabled;
      return { success: true, message: `internet ${enabled ? 'ENABLED' : 'DISABLED'} for ${mac}` };
    },
  };
}

// ── Resolve the provider for the chosen mode ─────────────────────────────────
async function resolveProvider() {
  if (SIMULATE) {
    const present = process.env.LIVE_SIM_OFFLINE !== '1';
    log(`MODE: SIMULATE (no network). Target ${present ? 'present' : 'OFFLINE'}.`);
    return { provider: makeFakeProvider({ present }), isFake: true };
  }
  // Real path — hard gates BEFORE any network module is loaded.
  if (process.env.ROUTER_PROVIDER !== 'asus') {
    log('REFUSED: real run needs ROUTER_PROVIDER=asus.');
    log('  → Dry-run instead:  LIVE_SIMULATE=1 node scripts/live-block-test.mjs');
    process.exit(1);
  }
  if (process.env.LIVE_CONFIRM !== '1') {
    log('REFUSED: real run needs explicit LIVE_CONFIRM=1 (this WILL cut the tablet’s internet).');
    log('  → Re-run:  ROUTER_PROVIDER=asus LIVE_CONFIRM=1 node --conditions=react-server \\');
    log('               --loader ./scripts/live-block-loader.mjs scripts/live-block-test.mjs');
    process.exit(1);
  }
  log('MODE: LIVE (real router via tested AsusWrtProvider).');
  const mod = await import(new URL('../src/server/router/index.ts', import.meta.url));
  const provider = await mod.getRouterProvider();
  return { provider, isFake: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const { provider, isFake } = await resolveProvider();

if (isFake) {
  process.on('exit', () => log('SIM final:', JSON.stringify(provider._state())));
}

async function restore(reason) {
  log(`RESTORE (${reason}) → setInternetAccess(${TARGET_MAC}, true)`);
  try {
    const r = await provider.setInternetAccess(TARGET_MAC, true);
    log(r.success ? `RESTORED: ${r.message}` : `RESTORE FAILED: ${r.message}`);
    return r.success;
  } catch (e) {
    log('RESTORE ERROR:', e?.message ?? e);
    return false;
  }
}

const watchdog = setTimeout(async () => {
  log(`WATCHDOG fired after ${WATCHDOG_MS}ms — forcing restore and exiting.`);
  await restore('watchdog');
  process.exit(1);
}, WATCHDOG_MS);

let exiting = false;
async function restoreAndExit(code, reason) {
  if (exiting) return;
  exiting = true;
  clearTimeout(watchdog);
  await restore(reason);
  process.exit(code);
}
process.on('SIGINT', () => { log('SIGINT received.'); void restoreAndExit(130, 'SIGINT'); });
process.on('SIGTERM', () => { log('SIGTERM received.'); void restoreAndExit(143, 'SIGTERM'); });

let blockedThisRun = false;
try {
  if (typeof provider.login === 'function') await provider.login();

  const clients = await provider.getClientList();
  const found = clients.find((c) => String(c.mac).toUpperCase() === TARGET_MAC);
  if (!found) {
    log(`SKIP: target ${TARGET_MAC} (${TARGET_LABEL}) is not in the online client list — offline/absent. No action taken.`);
    clearTimeout(watchdog);
    process.exit(0);
  }
  log(`Target present: ${found.name || TARGET_LABEL} @ ${found.ip || '?'} (${found.band || '?'})`);

  const baseline = typeof provider.getBlockState === 'function'
    ? await provider.getBlockState(TARGET_MAC)
    : null;
  log(`Baseline block state (null = unknown on stock firmware): ${baseline}`);

  log(`BLOCK → setInternetAccess(${TARGET_MAC}, false)`);
  const br = await provider.setInternetAccess(TARGET_MAC, false);
  if (!br.success) {
    log(`BLOCK FAILED: ${br.message}`);
    await restoreAndExit(1, 'block-failed');
  }
  blockedThisRun = true;
  log(`BLOCKED: ${br.message}`);
  log(`>>> VERIFY NOW: confirm "${found.name || TARGET_LABEL}" has lost internet.`);
  log(`    Auto-restore in ${VERIFY_SECONDS}s (watchdog backstop at ${Math.round(WATCHDOG_MS / 1000)}s; Ctrl-C restores immediately).`);

  await sleep(VERIFY_SECONDS * 1000);
  log('Verify window elapsed.');
  await restoreAndExit(0, 'normal');
} catch (e) {
  log('ERROR:', e?.message ?? e);
  await restoreAndExit(1, blockedThisRun ? 'exception-after-block' : 'exception');
}
