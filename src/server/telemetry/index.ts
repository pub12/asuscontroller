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
 *   This factory uses the '@/' path alias, so it is SERVER-SIDE ONLY.
 *   The plain-Node worker (scripts/worker.mjs) must NOT import this factory —
 *   it constructs new FakeTelemetryProvider() directly from the relative path,
 *   exactly as it does for FakeRouterProvider. This avoids the Next.js path-alias
 *   resolution that plain Node cannot handle.
 *
 * Why the static import of FakeTelemetryProvider is safe, and NextDnsProvider is lazy:
 *   FakeTelemetryProvider has no 'server-only' guard and makes no network calls —
 *   importing it statically is safe on every code path (identical to FakeRouterProvider).
 *   NextDnsProvider imports 'server-only' and reads NextDNS credentials at module
 *   initialisation time. A static import would run those side-effects even on the
 *   fake path, which would fail in test environments where no credentials are
 *   configured. The dynamic `await import()` ensures NextDnsProvider loads ONLY
 *   when mode === 'nextdns' — identical to how getRouterProvider handles AsusWrtProvider.
 *
 * The function is now ASYNC (returns Promise<TelemetryProvider>) to enable the
 * lazy import; callers must await it.
 */

import type { TelemetryProvider } from './TelemetryProvider';
import { FakeTelemetryProvider } from './FakeTelemetryProvider';
import { getTelemetryProviderMode } from '@/lib/env';

/**
 * Return the TelemetryProvider appropriate for the current environment.
 *
 * - On the 'fake' path (default): returns a FakeTelemetryProvider immediately.
 * - On the 'nextdns' path: lazily imports NextDnsProvider (pulling in server-only
 *   and credentials) and returns a new instance.
 *
 * @returns A TelemetryProvider ready to use. Callers should check isConfigured()
 *          before making data requests; providers return a NotConfiguredResult
 *          sentinel rather than throwing when credentials are absent.
 */
export async function getTelemetryProvider(): Promise<TelemetryProvider> {
  const mode = getTelemetryProviderMode();
  if (mode === 'nextdns') {
    const { NextDnsProvider } = await import('./NextDnsProvider');
    return new NextDnsProvider();
  }
  return new FakeTelemetryProvider();
}
