/**
 * ⛔ DO NOT RUN UNATTENDED — live router calls. Supervised session only.
 *
 * scripts/spike-router.mjs — Live feasibility spike for ASUS router control.
 *
 * PURPOSE:
 *   Verify the stock ASUS firmware CGI API contracts against real hardware:
 *   1. Login → acquire asus_token (measure/print token expiry).
 *   2. get_clientlist (READ only) — parse and print connected devices.
 *   3. Block/unblock SPIKE_TEST_MAC (WRITE path) — guinea-pig device only.
 *   4. Reboot-survival check (documented manual step — NOT automated).
 *
 * SAFETY GUARDS:
 *   - All live work is inside main(), which only runs when
 *     process.argv includes '--run-live-confirmed'.
 *   - Without the flag: print the banner and exit 0 — NO network calls.
 *   - This script is NEVER imported or called by the Next.js app.
 *
 * USAGE (supervised session only):
 *   1. Copy .env.example to .env and fill in ROUTER_HOST, ROUTER_USER,
 *      ROUTER_PASS, SPIKE_TEST_MAC.
 *   2. Confirm a human is watching and the guinea-pig device is ready.
 *   3. Run: node scripts/spike-router.mjs --run-live-confirmed
 *
 * REQUIRED ENV VARS (from .env):
 *   ROUTER_HOST     — IP or hostname of the ASUS router (e.g. "192.168.1.1")
 *   ROUTER_USER     — Router admin username
 *   ROUTER_PASS     — Router admin password
 *   SPIKE_TEST_MAC  — MAC of a guinea-pig device for the write path test
 *                     (e.g. "AA:BB:CC:DD:EE:FF")
 */

// ---------------------------------------------------------------------------
// Banner (printed on every invocation, with or without the live flag)
// ---------------------------------------------------------------------------

const BANNER = `
╔══════════════════════════════════════════════════════════════════════════╗
║  ⛔  DO NOT RUN UNATTENDED — LIVE ROUTER CALLS. SUPERVISED SESSION ONLY. ║
║                                                                          ║
║  This script WRITES to a live router. It will:                           ║
║    • Authenticate with the router (login.cgi)                            ║
║    • Read all connected clients (appGet.cgi get_clientlist)              ║
║    • Block then unblock SPIKE_TEST_MAC (applyapp.cgi set_client_state)   ║
║    • Optionally trigger a reboot (manual step — see instructions below)  ║
║                                                                          ║
║  Only proceed if:                                                        ║
║    1. A human supervisor is present and watching.                        ║
║    2. SPIKE_TEST_MAC is a guinea-pig device (not a critical device).     ║
║    3. You have read docs/phase1-feasibility-report.md beforehand.        ║
║                                                                          ║
║  To run: node scripts/spike-router.mjs --run-live-confirmed              ║
╚══════════════════════════════════════════════════════════════════════════╝
`;

// ---------------------------------------------------------------------------
// Guard: only proceed with live work when explicitly confirmed
// ---------------------------------------------------------------------------

const LIVE_FLAG = '--run-live-confirmed';

if (!process.argv.includes(LIVE_FLAG)) {
  console.log(BANNER);
  console.log('No live calls made. To run the spike, pass the flag:');
  console.log(`  node scripts/spike-router.mjs ${LIVE_FLAG}\n`);
  process.exit(0);
}

// If we reach here, the flag was provided. The human has confirmed.
// All live work is in main() below.

// ---------------------------------------------------------------------------
// Imports (only used when --run-live-confirmed is present)
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// .env loader (minimal — no dotenv dependency needed for a spike)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '../.env');

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error(`[spike-router] ERROR: .env not found at ${ENV_PATH}`);
    console.error('Copy .env.example to .env and fill in ROUTER_HOST, ROUTER_USER, ROUTER_PASS, SPIKE_TEST_MAC.');
    process.exit(1);
  }

  const contents = readFileSync(ENV_PATH, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`[spike-router] ERROR: Required env var ${name} is not set. Edit .env.`);
    process.exit(1);
  }
  return val;
}

function encodeCredentials(user, pass) {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

// ---------------------------------------------------------------------------
// Step 1 — Login (POST /login.cgi)
// ---------------------------------------------------------------------------

/**
 * Authenticate with the router. Returns the asus_token string.
 * Prints the time the token was acquired (expiry is unknown until verified
 * against live hardware — assumed ~30 min; document actual TTL in the report).
 */
async function login(host, user, pass) {
  console.log(`\n[Step 1] Login → http://${host}/login.cgi`);
  const loginStart = Date.now();

  const url = `http://${host}/login.cgi`;
  const body = new URLSearchParams({
    login_authorization: encodeCredentials(user, pass),
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'DarylWeb-spike/0.1',
        Referer: `http://${host}/`,
      },
      body: body.toString(),
    });
  } catch (err) {
    console.error(`[spike-router] Login fetch failed: ${err.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`[spike-router] Login HTTP ${response.status}. Check ROUTER_HOST/USER/PASS.`);
    process.exit(1);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    console.error('[spike-router] Login response is not JSON. Verify the stock firmware login endpoint.');
    process.exit(1);
  }

  const token = json?.asus_token;
  if (!token) {
    console.error('[spike-router] asus_token not found in login response.');
    console.error('Response keys:', Object.keys(json ?? {}));
    console.error('Full response body:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const loginMs = Date.now() - loginStart;
  console.log(`  ✓ Token acquired in ${loginMs}ms.`);
  console.log(`  Token value (first 8 chars): ${token.slice(0, 8)}...`);
  console.log(`  Token length: ${token.length} chars`);
  console.log(`  Token acquired at: ${new Date().toISOString()}`);
  console.log(`  Assumed TTL: ~30 min (UNVERIFIED — document actual expiry from live firmware).`);
  console.log(`  TODO for report: log the router's session-timeout NVRAM var if accessible.`);

  return token;
}

// ---------------------------------------------------------------------------
// Step 2 — Read client list (GET /appGet.cgi?hook=get_clientlist())
// ---------------------------------------------------------------------------

/**
 * Fetch and parse the connected client list. READ ONLY.
 * Prints all clients to stdout for inspection. Returns the parsed array.
 */
async function getClientList(host, token) {
  console.log(`\n[Step 2] get_clientlist (READ) → http://${host}/appGet.cgi?hook=get_clientlist()`);

  const url = `http://${host}/appGet.cgi?hook=get_clientlist()`;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: `asus_token=${token}`,
        'User-Agent': 'DarylWeb-spike/0.1',
        Referer: `http://${host}/`,
      },
    });
  } catch (err) {
    console.error(`[spike-router] get_clientlist fetch failed: ${err.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`[spike-router] get_clientlist HTTP ${response.status}.`);
    process.exit(1);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    const text = await response.text().catch(() => '[unreadable]');
    console.error('[spike-router] get_clientlist response is not JSON.');
    console.error('Raw response (first 500 chars):', text.slice(0, 500));
    process.exit(1);
  }

  const rawList = json?.get_clientlist ?? '';
  console.log(`  Raw get_clientlist value (first 500 chars):`);
  console.log(`  ${rawList.slice(0, 500)}`);

  // Parse the raw client list
  const clients = parseClientList(rawList);
  console.log(`\n  Parsed ${clients.length} client(s):`);
  for (const c of clients) {
    const status = c.connected ? '●  online' : '○  offline';
    console.log(`    ${status}  ${c.mac}  ${c.ip.padEnd(15)}  ${c.band.padEnd(4)}  ${c.name}`);
  }

  console.log('\n  TODO for report: Note the raw format (delimiter, field count, field order).');
  return clients;
}

/**
 * Parse the raw get_clientlist NVRAM string.
 * Format (ZenWiFi stock firmware): <MAC><IP><Name><Connected><Band><Vendor>;...
 * Delimiter and field order: VERIFY against live firmware and document in report.
 */
function parseClientList(raw) {
  if (!raw || raw.trim() === '') return [];

  const delimiter = raw.includes(';') ? ';' : '\n';
  const records = raw.split(delimiter).map(r => r.trim()).filter(Boolean);
  const clients = [];

  for (const record of records) {
    const matches = record.match(/<([^>]*)>/g);
    if (!matches || matches.length < 3) continue;

    const fields = matches.map(m => m.slice(1, -1));
    const mac = fields[0] ?? '';
    if (!mac) continue;

    clients.push({
      mac: mac.toUpperCase(),
      ip: fields[1] ?? '',
      name: fields[2] ?? '',
      connected: (fields[3] ?? '0') === '1',
      band: fields[4] ?? '',
      vendor: fields[5] ?? '',
    });
  }

  return clients;
}

// ---------------------------------------------------------------------------
// Step 3 — Block / unblock guinea-pig (WRITE path)
// ---------------------------------------------------------------------------

/**
 * Block then unblock SPIKE_TEST_MAC using set_client_state.
 *
 * POST /applyapp.cgi
 *   Body: hook=set_client_state(<mac>,<enabled>,<cut_mac>,<group>)
 *
 * This is the v1 internet on/off block mechanism (NVRAM-backed).
 * Verify the exact hook argument format against live firmware and document.
 */
async function testBlockUnblock(host, token, mac) {
  console.log(`\n[Step 3] Block/unblock guinea-pig: ${mac}`);

  // --- BLOCK ---
  console.log(`\n  [3a] Blocking ${mac}...`);
  const blockResult = await setClientState(host, token, mac, false);
  console.log(`       Result: HTTP ${blockResult.status} — ${blockResult.ok ? '✓ OK' : '✗ FAILED'}`);
  if (!blockResult.ok) {
    console.error(`       Response: ${blockResult.body.slice(0, 300)}`);
    console.error('       Spike aborted — check the hook format against live firmware.');
    process.exit(1);
  }
  console.log(`       Sleeping 3s — observe the guinea-pig device losing internet...`);
  await sleep(3000);

  // Verify block via client list
  console.log(`  [3a-verify] Re-reading client list to confirm block state...`);
  await getClientList(host, token);
  console.log(`  TODO for report: Confirm the client's internet is actually blocked (test from the device).`);

  // --- UNBLOCK ---
  console.log(`\n  [3b] Unblocking ${mac}...`);
  const unblockResult = await setClientState(host, token, mac, true);
  console.log(`       Result: HTTP ${unblockResult.status} — ${unblockResult.ok ? '✓ OK' : '✗ FAILED'}`);
  if (!unblockResult.ok) {
    console.error(`       Response: ${unblockResult.body.slice(0, 300)}`);
    console.error(`       WARNING: ${mac} may still be blocked! Manually unblock via the router UI.`);
    process.exit(1);
  }
  console.log(`       Sleeping 3s — observe the guinea-pig device regaining internet...`);
  await sleep(3000);

  console.log(`\n  ✓ Block/unblock cycle complete for ${mac}.`);
  console.log(`  TODO for report:`);
  console.log(`    - Document exact hook format that worked: set_client_state(<mac>,<flag>,<cut_mac>,<group>)`);
  console.log(`    - Note the response body format.`);
  console.log(`    - Note any observable delay between the API call and actual blocking taking effect.`);
}

/**
 * Call set_client_state on the router.
 * Returns { status, ok, body }.
 */
async function setClientState(host, token, mac, enabled) {
  // Hook format: verify arity against live firmware.
  // Common formats seen in ASUSWRT source:
  //   set_client_state(<mac>,<enabled>,<cut_mac>,<group>)
  //   set_client_state(<mac>,<enabled>)
  // Try the 4-arg form first; document which one works.
  const enabledFlag = enabled ? '1' : '0';
  const hook = `set_client_state(${mac},${enabledFlag},${mac},)`;

  const url = `http://${host}/applyapp.cgi`;
  const body = new URLSearchParams({ hook });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Cookie: `asus_token=${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'DarylWeb-spike/0.1',
        Referer: `http://${host}/`,
      },
      body: body.toString(),
    });
  } catch (err) {
    return { status: 0, ok: false, body: err.message };
  }

  const text = await response.text().catch(() => '');
  return { status: response.status, ok: response.ok, body: text };
}

// ---------------------------------------------------------------------------
// Step 4 — Reboot-survival check (MANUAL STEP — documented only)
// ---------------------------------------------------------------------------

/**
 * Reboot-survival check placeholder.
 *
 * This step is NOT automated — it requires a human to:
 *   1. Block the guinea-pig device (Step 3a).
 *   2. Reboot the router (see below or via router UI).
 *   3. Wait ~60s for the router to come back online.
 *   4. Re-read the client list and verify the device is still blocked.
 *   5. Document whether block state persisted (NVRAM-backed or not).
 *
 * If you want to trigger a reboot via the API (CAUTION — drops all connections):
 *   POST /applyapp.cgi  body: hook=reboot
 *   Then wait 60s before re-connecting.
 *
 * Document the result in docs/phase1-feasibility-report.md §3.
 */
function printRebootSurvivalInstructions() {
  console.log('\n[Step 4] Reboot-survival check (MANUAL — not automated)');
  console.log('');
  console.log('  To verify block state persists across a reboot:');
  console.log('  1. Block the guinea-pig device (Step 3a above or via the router UI).');
  console.log('  2. Trigger a reboot:');
  console.log('       Via API: POST /applyapp.cgi  body=hook=reboot');
  console.log('       Via UI:  Administration → Reboot in the ASUS dashboard.');
  console.log('  3. Wait ~60s for the router to come back online.');
  console.log('  4. Re-run this spike (Step 2 only) and observe the guinea-pig\'s blocked status.');
  console.log('  5. Document in docs/phase1-feasibility-report.md §3:');
  console.log('       - Did block state persist? (yes / no)');
  console.log('       - If no: what reconcile strategy is needed in Phase 4?');
  console.log('');
  console.log('  ⚠️  If you use the API reboot, all clients (including this machine) will');
  console.log('      lose connectivity for ~60s. Only do this if you are on a wired connection');
  console.log('      or have a fallback network path.');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// main() — all live work happens here
// ---------------------------------------------------------------------------

async function main() {
  console.log(BANNER);
  console.log('⚡ --run-live-confirmed flag detected. Proceeding with live router calls.\n');
  console.log('Timestamp:', new Date().toISOString());

  // Load .env
  loadEnv();

  // Read and validate required env vars
  const host = requireEnv('ROUTER_HOST');
  const user = requireEnv('ROUTER_USER');
  const pass = requireEnv('ROUTER_PASS');
  const testMac = requireEnv('SPIKE_TEST_MAC');

  console.log(`\nTarget router: http://${host}`);
  console.log(`Guinea-pig MAC: ${testMac}`);
  console.log('');

  // Step 1: Login
  const token = await login(host, user, pass);

  // Step 2: Read client list (read-only)
  const clients = await getClientList(host, token);

  // Verify the guinea-pig MAC is known to the router
  const guineaPig = clients.find(c => c.mac.toUpperCase() === testMac.toUpperCase());
  if (!guineaPig) {
    console.warn(`\n  ⚠️  WARNING: SPIKE_TEST_MAC (${testMac}) not found in client list.`);
    console.warn('  The device may be offline, or the MAC may be wrong.');
    console.warn('  Proceeding with the write path anyway — the router may still accept the state change.');
  } else {
    console.log(`\n  ✓ Guinea-pig found: ${guineaPig.mac} / ${guineaPig.ip} / ${guineaPig.name}`);
    console.log(`    Currently: ${guineaPig.connected ? 'connected' : 'disconnected'}`);
  }

  // Step 3: Block/unblock write path
  await testBlockUnblock(host, token, testMac.toUpperCase());

  // Step 4: Reboot-survival (manual instructions)
  printRebootSurvivalInstructions();

  // Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('Spike complete. Next steps:');
  console.log('  1. Fill in docs/phase1-feasibility-report.md §§1–3 with your findings.');
  console.log('  2. Document the client list format (delimiter, field order, field count).');
  console.log('  3. Document the set_client_state hook format that worked.');
  console.log('  4. Complete the reboot-survival manual step (Step 4 above).');
  console.log('  5. Update AsusWrtProvider.ts if the actual API differs from the draft.');
  console.log('════════════════════════════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('\n[spike-router] Unhandled error:', err);
  process.exit(1);
});
