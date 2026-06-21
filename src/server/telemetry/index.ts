/**
 * src/server/telemetry/index.ts — TelemetryProvider factory.
 *
 * Use getTelemetryProvider() from any server-side path (API routes, Server
 * Actions, the ingest worker) to get the correct TelemetryProvider for the
 * current environment without having to know which mode is active.
 *
 * Mode is controlled by the TELEMETRY_PROVIDER env var (see src/lib/env.ts):
 *   TELEMETRY_PROVIDER=fake     (default) → FakeTelemetryProvider (in-memory, no network)
 *   TELEMETRY_PROVIDER=nextdns            → NextDnsProvider (real DNS telemetry, server-only)
 *
 * WORKER-PURITY RULE:
 *   This factory uses require() and the '@/' path alias, so it is SERVER-SIDE ONLY.
 *   The plain-Node worker (scripts/worker.mjs) must NOT import this factory —
 *   it constructs new FakeTelemetryProvider() directly from the relative path,
 *   exactly as it does for FakeRouterProvider. This avoids the Next.js path-alias
 *   resolution that plain Node cannot handle.
 *
 * Why require() is used for BOTH branches (not await import()):
 *   1. NextDnsProvider imports 'server-only' and must only load on the nextdns
 *      branch — a static import would run its side-effects on every path.
 *   2. FakeTelemetryProvider does not exist yet (built in the next phase). Using
 *      require() means tsc does not statically resolve the module path, so this
 *      file typechecks correctly before the sibling is created.
 */

import type { TelemetryProvider } from './TelemetryProvider';
import { getTelemetryProviderMode } from '@/lib/env';

/**
 * Return the TelemetryProvider appropriate for the current environment.
 *
 * - On the 'fake' path (default): returns a FakeTelemetryProvider immediately.
 * - On the 'nextdns' path: lazily requires NextDnsProvider (pulling in server-only
 *   and credentials) and returns a new instance.
 *
 * @returns A TelemetryProvider ready to use. Callers should check isConfigured()
 *          before making data requests; providers return a NotConfiguredResult
 *          sentinel rather than throwing when credentials are absent.
 */
export function getTelemetryProvider(): TelemetryProvider {
  const mode = getTelemetryProviderMode();
  if (mode === 'nextdns') {
    const { NextDnsProvider } = require('./NextDnsProvider');
    return new NextDnsProvider();
  }
  const { FakeTelemetryProvider } = require('./FakeTelemetryProvider');
  return new FakeTelemetryProvider();
}
