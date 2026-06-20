/**
 * src/server/router/index.ts — RouterProvider factory.
 *
 * Use getRouterProvider() from any server-side path (API routes, Server
 * Actions, the polling service) to get the correct RouterProvider for the
 * current environment without having to know which mode is active.
 *
 * Mode is controlled by the ROUTER_PROVIDER env var (see src/lib/env.ts):
 *   ROUTER_PROVIDER=fake  (default) → FakeRouterProvider (in-memory, no network)
 *   ROUTER_PROVIDER=asus            → AsusWrtProvider (real router, server-only)
 *
 * Why the AsusWrtProvider import is lazy (dynamic import):
 *   AsusWrtProvider imports 'server-only' and reads router credentials from
 *   secrets at module initialisation time. A static import would load those
 *   side-effects even on the fake path, which would fail in test environments
 *   where no credentials are configured. The dynamic import ensures the
 *   real-router module is loaded ONLY when mode === 'asus'.
 *
 * Note for the sync worker (scripts/worker.mjs, a later phase):
 *   The plain-Node worker does NOT use this factory because plain Node cannot
 *   resolve the '@/' path alias used by getRouterProviderMode(). Instead, the
 *   worker imports FakeRouterProvider directly from the relative path. This is
 *   safe because ROUTER_PROVIDER stays 'fake' for the entire device-sync build.
 */

import type { RouterProvider } from './RouterProvider';
import { FakeRouterProvider } from './FakeRouterProvider';
import { getRouterProviderMode } from '@/lib/env';

/**
 * Return the RouterProvider appropriate for the current environment.
 *
 * - On the 'fake' path (default): returns a FakeRouterProvider immediately.
 * - On the 'asus' path: lazily imports AsusWrtProvider (pulling in server-only
 *   and credentials) and returns a new instance.
 *
 * @returns A RouterProvider ready to use. Callers should still call login()
 *          if they intend to make authenticated requests (AsusWrtProvider
 *          requires it; FakeRouterProvider accepts the call as a no-op).
 */
export async function getRouterProvider(): Promise<RouterProvider> {
  const mode = getRouterProviderMode();

  if (mode === 'asus') {
    const { AsusWrtProvider } = await import('./AsusWrtProvider');
    return new AsusWrtProvider();
  }

  return new FakeRouterProvider();
}
