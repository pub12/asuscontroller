/**
 * Deterministic Next.js launcher for the hazo_admin test-app.
 *
 * Two jobs:
 *
 * 1. Resolve the RIGHT Next. This test-app runs on Next 16, but the workspace
 *    root hoists an older Next 14 (from sibling test-apps). A bare `next dev` /
 *    `next build` resolved via npm's PATH (or `npx next`) can pick up the
 *    hoisted Next 14 → React 19 RSC crash. require.resolve() from this file
 *    resolves to the package-local Next 16, so we always launch the correct bin.
 *
 * 2. Honor the workspace-standard PORT convention. For `dev`/`start`, the port
 *    comes from `PORT` (e.g. `PORT=3009 npm run dev:test-app`), defaulting to
 *    3300 (3000 is commonly taken by a consuming app). An explicit `-p`/`--port`
 *    in the args still wins.
 *
 * 3. Add the `react-server` Node import condition for `dev`/`start`. The
 *    in-process hazo_jobs worker (instrumentation.ts) runs env migrations, whose
 *    best-effort audit does `optional_import('hazo_audit/server')`. That module
 *    `import`s `server-only`; because optional_import uses a `turbopackIgnore`
 *    dynamic import, Node resolves server-only NATIVELY under its `default`
 *    condition — the throwing guard ("cannot be imported from a Client Component
 *    module"). Under Turbopack dev, Next's import tracer surfaces that throw on a
 *    path that bypasses optional_import's try/catch AND process-level
 *    unhandledRejection/uncaughtException handlers, killing the worker (and the
 *    whole dev server). The `react-server` condition makes server-only resolve
 *    its no-op `empty.js` instead, so it never throws. Only bundler-ignored
 *    native imports are affected (Turbopack bundles app code with its own
 *    resolver), so app rendering is unchanged.
 *
 * Usage: node scripts/next.mjs <dev|build|start> [...args]
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const DEFAULT_PORT = '3400';
const args = process.argv.slice(2);
const subcommand = args[0];

// Inject the port for dev/start unless the caller already passed one.
const hasExplicitPort = args.some((a) => a === '-p' || a === '--port');
if ((subcommand === 'dev' || subcommand === 'start') && !hasExplicitPort) {
  args.push('-p', process.env.PORT || DEFAULT_PORT);
}

// Add the react-server condition for the runtimes that start the env worker.
// Passed via NODE_OPTIONS so Next's forked server/worker processes inherit it.
const env = { ...process.env };
if (subcommand === 'dev' || subcommand === 'start') {
  const COND = '--conditions=react-server';
  env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${COND}` : COND;
}

const result = spawnSync(process.execPath, [nextBin, ...args], { stdio: 'inherit', env });

// Surface the real reason Next stopped. Without this, a signal death (native
// crash, OOM, an external `kill`) leaves `result.status === null`, and a bare
// `process.exit(result.status ?? 0)` reports a clean exit 0 — i.e. the server
// "stops by itself" with no error. Re-raise so the cause is visible.
if (result.error) {
  console.error('[next.mjs] failed to launch Next:', result.error);
  process.exit(1);
}
if (result.signal) {
  console.error(`[next.mjs] Next was terminated by signal ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 0);
