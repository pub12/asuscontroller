#!/usr/bin/env node
/**
 * scripts/doctor.mjs — NetWarden environment doctor
 *
 * Imports hazo_env doctor() and prints the full report to stdout.
 * Exits with code 1 if any check fails so CI can catch config regressions.
 *
 * Usage:
 *   npm run doctor
 *   npm run doctor -- --probe     (also open the SQLite file)
 *   npm run doctor -- --all       (check all envs in pattern)
 */
import { doctor } from 'hazo_env';

const args = process.argv.slice(2);
const probe = args.includes('--probe');
const all = args.includes('--all');
const envFlagIdx = args.findIndex((a) => a === '--env');
const env =
  envFlagIdx >= 0
    ? args[envFlagIdx + 1]
    : args.find((a) => a.startsWith('--env='))?.split('=')[1];

const report = await doctor({ env, all, probe });

const icons = { ok: '✓', warn: '⚠', error: '✗' };
console.log(`\nNetWarden — hazo-env doctor  (env: ${report.env})\n`);

const width = Math.max(...report.checks.map((c) => c.label.length)) + 2;
for (const check of report.checks) {
  const icon = icons[check.status];
  const label = check.label.padEnd(width);
  const detail = check.detail ? `  ${check.detail}` : '';
  console.log(`  ${icon} ${label}${detail}`);
}

console.log('');
if (report.passed) {
  console.log('  All checks passed.\n');
} else {
  console.error('  One or more checks failed. Fix the errors above.\n');
}

// --- NetWarden sync config ---
console.log('NetWarden — sync config\n');

let syncConfigPassed = true;

// ROUTER_PROVIDER
const rawProvider = process.env['ROUTER_PROVIDER'];
const validProviders = ['fake', 'asus'];
let providerValue = rawProvider === undefined || rawProvider === '' ? 'fake' : rawProvider;
if (!validProviders.includes(providerValue)) {
  console.log(`  ${icons.error} ROUTER_PROVIDER  "${providerValue}" is not valid — expected "fake" or "asus"`);
  syncConfigPassed = false;
} else {
  const isDefault = rawProvider === undefined || rawProvider === '';
  console.log(`  ${icons.ok} ROUTER_PROVIDER  ${providerValue}${isDefault ? '  (default)' : ''}`);
}

// SYNC_INTERVAL_SEC
const rawInterval = process.env['SYNC_INTERVAL_SEC'];
let intervalValue = 60;
if (rawInterval === undefined || rawInterval === '') {
  console.log(`  ${icons.ok} SYNC_INTERVAL_SEC  60  (default)`);
} else {
  const parsed = Number.parseInt(rawInterval, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== rawInterval.trim()) {
    console.log(`  ${icons.error} SYNC_INTERVAL_SEC  "${rawInterval}" is not a positive integer`);
    syncConfigPassed = false;
  } else {
    intervalValue = parsed;
    console.log(`  ${icons.ok} SYNC_INTERVAL_SEC  ${intervalValue}`);
  }
}

// RAW_EVENT_RETENTION_DAYS
const rawRetention = process.env['RAW_EVENT_RETENTION_DAYS'];
if (rawRetention === undefined || rawRetention === '') {
  console.log(`  ${icons.ok} RAW_EVENT_RETENTION_DAYS  30  (default)`);
} else {
  const parsedRetention = Number.parseInt(rawRetention, 10);
  if (!Number.isFinite(parsedRetention) || parsedRetention <= 0 || String(parsedRetention) !== rawRetention.trim()) {
    console.log(`  ${icons.error} RAW_EVENT_RETENTION_DAYS  "${rawRetention}" is not a positive integer`);
    syncConfigPassed = false;
  } else {
    console.log(`  ${icons.ok} RAW_EVENT_RETENTION_DAYS  ${parsedRetention}`);
  }
}

// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
const hasTelegramToken = Boolean(process.env['TELEGRAM_BOT_TOKEN']);
const hasTelegramChat = Boolean(process.env['TELEGRAM_CHAT_ID']);
if (hasTelegramToken && hasTelegramChat) {
  console.log(`  ${icons.ok} TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID  notify enabled`);
} else {
  console.log(`  ${icons.warn} TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID  notify disabled — alerts will no-op`);
}

console.log('');

if (!report.passed || !syncConfigPassed) {
  process.exit(1);
} else {
  process.exit(0);
}
