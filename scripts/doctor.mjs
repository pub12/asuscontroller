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
  process.exit(0);
} else {
  console.error('  One or more checks failed. Fix the errors above.\n');
  process.exit(1);
}
