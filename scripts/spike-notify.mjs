/**
 * scripts/spike-notify.mjs — Contract-smoke spike for hazo_notify (Telegram adapter).
 *
 * PURPOSE:
 *   Verify the hazo_notify package is importable and the TelegramChannel adapter
 *   exposes the expected contract shape. Optionally sends a live test alert.
 *
 *   With --run-live-confirmed:
 *     1. Imports hazo_notify/adapters/telegram and logs exported names.
 *     2. Constructs a TelegramChannel instance (proves the adapter builds).
 *     3. Validates a test payload (validate() method).
 *     4. If TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are in env, sends ONE live
 *        Telegram message — "NetWarden spike-notify test".
 *     5. If creds are absent, skips the live send and logs "no creds — skipped".
 *     6. Prints PASS or FAIL with details.
 *
 * SAFETY GUARDS:
 *   - Without --run-live-confirmed: prints this banner and exits 0.
 *     NO Telegram messages are sent unattended.
 *   - This script is NEVER imported or called by the Next.js app.
 *
 * USAGE:
 *   node scripts/spike-notify.mjs
 *   node scripts/spike-notify.mjs --run-live-confirmed
 *
 * OPTIONAL ENV VARS (from .env):
 *   TELEGRAM_BOT_TOKEN  — Telegram bot token (from @BotFather)
 *   TELEGRAM_CHAT_ID    — Target chat/channel ID (numeric or @channel)
 */

const BANNER = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  scripts/spike-notify.mjs — hazo_notify / Telegram contract smoke           ║
║                                                                              ║
║  This script probes the hazo_notify TelegramChannel adapter contract.        ║
║  With --run-live-confirmed it will:                                          ║
║    • Import hazo_notify/adapters/telegram and inspect exports                ║
║    • Construct a TelegramChannel instance                                    ║
║    • Call validate() on a test payload                                       ║
║    • If TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set in env:                ║
║        Send ONE test Telegram message to confirm the live path               ║
║    • Without creds: skip the live send (PASS — contract shape proven)        ║
║                                                                              ║
║  To run: node scripts/spike-notify.mjs --run-live-confirmed                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

const LIVE_FLAG = '--run-live-confirmed';

if (!process.argv.includes(LIVE_FLAG)) {
  console.log(BANNER);
  console.log('No side effects. To run the smoke, pass the flag:');
  console.log(`  node scripts/spike-notify.mjs ${LIVE_FLAG}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Imports (only after guard)
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// .env loader (same pattern as spike-router.mjs)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '../.env');

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.log('[spike-notify] .env not found — skipping env load, using process.env only.');
    return;
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
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ''}`);
  failed++;
}

function assertExport(mod, name, expectedType) {
  const actual = typeof mod[name];
  if (actual !== 'undefined') {
    const typeOk = !expectedType || actual === expectedType;
    if (typeOk) {
      ok(`hazo_notify/adapters/telegram exports: ${name} (${actual})`);
    } else {
      fail(`${name} has wrong type: expected ${expectedType}, got ${actual}`);
    }
  } else {
    fail(`hazo_notify/adapters/telegram missing export: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n[spike-notify] Starting contract smoke...\n');

  loadEnv();

  // ── Section 1: import hazo_notify/adapters/telegram ─────────────────────
  console.log('── hazo_notify/adapters/telegram ──────────────────────────────');

  let telegramModule;
  try {
    telegramModule = await import('hazo_notify/adapters/telegram');
    ok('hazo_notify/adapters/telegram: import succeeded');
  } catch (err) {
    fail('hazo_notify/adapters/telegram: import failed', err.message);
    printSummary();
    return;
  }

  const exportNames = Object.keys(telegramModule);
  console.log(`  Exported names: ${exportNames.join(', ')}\n`);

  // Assert key contracts
  assertExport(telegramModule, 'TelegramChannel', 'function');
  assertExport(telegramModule, 'load_telegram_config', 'function');
  assertExport(telegramModule, 'makeTransport', 'function');
  assertExport(telegramModule, 'splitMessage', 'function');
  assertExport(telegramModule, 'MAX_TG_LEN');

  // ── Section 2: Construct TelegramChannel ────────────────────────────────
  console.log('\n── TelegramChannel constructor ─────────────────────────────────');

  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  const hasCreds = Boolean(botToken && chatId);

  let channel;
  try {
    // Construct with an explicit config to avoid reading a missing config file
    channel = new telegramModule.TelegramChannel({
      config: {
        bot_token: botToken || 'placeholder-no-creds',
        default_chat_id: chatId || '0',
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        transport: 'node',
        request_timeout_ms: 10000,
        api_base_url: 'https://api.telegram.org',
      },
    });
    ok('new TelegramChannel({ config }) constructed without throwing');
  } catch (err) {
    fail('TelegramChannel constructor threw', err.message);
    printSummary();
    return;
  }

  // Verify capabilities
  if (channel.capabilities && typeof channel.capabilities === 'object') {
    ok(`capabilities object present: ${JSON.stringify(channel.capabilities)}`);
  } else {
    fail('channel.capabilities missing or not an object');
  }

  // ── Section 3: validate() ────────────────────────────────────────────────
  console.log('\n── validate() contract ─────────────────────────────────────────');

  const testPayload = {
    text: 'NetWarden spike-notify test',
    parse_mode: 'HTML',
    chat_id: chatId || '0',
  };

  try {
    const validResult = channel.validate(testPayload);
    // hazo_notify TelegramChannel.validate() returns { ok: boolean } shape
    // (not { valid: boolean } as the ChannelAdapter base type suggests).
    const hasOkShape = validResult && typeof validResult.ok === 'boolean';
    const hasValidShape = validResult && typeof validResult.valid === 'boolean';
    if (hasOkShape) {
      ok(`validate() returned { ok: ${validResult.ok} } (TelegramChannel shape)`);
    } else if (hasValidShape) {
      ok(`validate() returned { valid: ${validResult.valid} } (ChannelAdapter shape)`);
    } else {
      fail('validate() did not return expected shape', JSON.stringify(validResult));
    }
  } catch (err) {
    fail('validate() threw', err.message);
  }

  // ── Section 4: Live send (optional — creds required) ────────────────────
  console.log('\n── Live send (optional) ────────────────────────────────────────');

  if (!hasCreds) {
    console.log('  ⚠ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set in env.');
    console.log('  ⚠ Skipping live send — contract shape proven, no creds needed for PASS.');
    ok('live send skipped (no creds) — seam fallback confirmed');
  } else {
    console.log(`  TELEGRAM_BOT_TOKEN: ${botToken.slice(0, 8)}...`);
    console.log(`  TELEGRAM_CHAT_ID:   ${chatId}`);
    console.log('  Sending test message...');

    try {
      const ctx = {
        channel: 'telegram',
        event_id: 'spike-notify-test',
        timestamp: new Date().toISOString(),
      };
      const result = await channel.send(
        {
          text: '<b>NetWarden spike-notify test</b>\nContract smoke passed.',
          parse_mode: 'HTML',
          chat_id: chatId,
        },
        ctx
      );

      if (result && result.success) {
        ok(`send() returned success=true (message_id=${result.message_id ?? 'n/a'})`);
      } else {
        fail('send() returned non-success', JSON.stringify(result));
      }
    } catch (err) {
      fail('send() threw', err.message);
    }
  }

  printSummary();
}

function printSummary() {
  console.log('\n══════════════════════════════════════════════════════════════');
  const total = passed + failed;
  if (failed === 0) {
    console.log(`PASS  ${passed}/${total} checks passed.`);
    console.log('══════════════════════════════════════════════════════════════\n');
    process.exit(0);
  } else {
    console.error(`FAIL  ${passed}/${total} passed, ${failed} failed.`);
    console.log('══════════════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n[spike-notify] Unhandled error:', err);
  process.exit(1);
});
