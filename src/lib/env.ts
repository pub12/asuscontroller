/**
 * Typed environment accessor for NetWarden.
 * Thin wrapper over hazo_env getEnv() / isDev / isTest / isProd.
 * Server-safe — never bundled to the client (no 'server-only' marker
 * needed here because we only re-export scalars; secrets live in src/server/secrets.ts).
 */
import { getEnv, isDev, isTest, isProd } from 'hazo_env';

// Re-export env predicates for convenience
export { isDev, isTest, isProd };

/** Known application environment variables with their types. */
export interface AppEnvVars {
  HAZO_ENV: string;
  SUPERADMIN_EMAIL: string | undefined;
  SUPERADMIN_PASSWORD: string | undefined;
  JWT_SECRET: string | undefined;
  HAZO_AUTH_COOKIE_PREFIX: string | undefined;
  ROUTER_HOST: string | undefined;
  ROUTER_USER: string | undefined;
  ROUTER_PASS: string | undefined;
  SPIKE_TEST_MAC: string | undefined;
  NEXTDNS_API_KEY: string | undefined;
  ROUTER_PROVIDER: string | undefined;
  SYNC_INTERVAL_SEC: string | undefined;
  TELEMETRY_PROVIDER: string | undefined;
  TELEMETRY_INGEST_SEC: string | undefined;
}

/**
 * Return a typed snapshot of all known env vars.
 * Missing vars are typed as `undefined` — use requireEnv() when you need
 * to assert presence at call-site.
 */
export function getAppEnv(): AppEnvVars {
  return {
    HAZO_ENV: getEnv(),
    SUPERADMIN_EMAIL: process.env['SUPERADMIN_EMAIL'],
    SUPERADMIN_PASSWORD: process.env['SUPERADMIN_PASSWORD'],
    JWT_SECRET: process.env['JWT_SECRET'],
    HAZO_AUTH_COOKIE_PREFIX: process.env['HAZO_AUTH_COOKIE_PREFIX'],
    ROUTER_HOST: process.env['ROUTER_HOST'],
    ROUTER_USER: process.env['ROUTER_USER'],
    ROUTER_PASS: process.env['ROUTER_PASS'],
    SPIKE_TEST_MAC: process.env['SPIKE_TEST_MAC'],
    NEXTDNS_API_KEY: process.env['NEXTDNS_API_KEY'],
    ROUTER_PROVIDER: process.env['ROUTER_PROVIDER'],
    SYNC_INTERVAL_SEC: process.env['SYNC_INTERVAL_SEC'],
    TELEMETRY_PROVIDER: process.env['TELEMETRY_PROVIDER'],
    TELEMETRY_INGEST_SEC: process.env['TELEMETRY_INGEST_SEC'],
  };
}

/**
 * Return the active router provider mode.
 * Defaults to `'fake'` when ROUTER_PROVIDER is unset.
 * Throws a clear error if set to an unrecognised value.
 */
export function getRouterProviderMode(): 'fake' | 'asus' {
  const raw = process.env['ROUTER_PROVIDER'];
  if (raw === undefined || raw === '') return 'fake';
  if (raw === 'fake' || raw === 'asus') return raw;
  throw new Error(
    `[netwarden] ROUTER_PROVIDER has unrecognised value "${raw}". ` +
      `Expected "fake" or "asus".`
  );
}

/**
 * Return the active telemetry provider mode.
 * Defaults to `'fake'` when TELEMETRY_PROVIDER is unset.
 * Throws a clear error if set to an unrecognised value.
 */
export function getTelemetryProviderMode(): 'fake' | 'nextdns' {
  const raw = process.env['TELEMETRY_PROVIDER'];
  if (raw === undefined || raw === '') return 'fake';
  if (raw === 'fake' || raw === 'nextdns') return raw;
  throw new Error(
    `[netwarden] TELEMETRY_PROVIDER has unrecognised value "${raw}". ` +
      `Expected "fake" or "nextdns".`
  );
}

/**
 * Return the sync-worker polling interval in seconds.
 * Defaults to `60` when SYNC_INTERVAL_SEC is unset.
 * Throws a clear error if set but not a positive integer.
 */
export function getSyncIntervalSec(): number {
  const raw = process.env['SYNC_INTERVAL_SEC'];
  if (raw === undefined || raw === '') return 60;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
    throw new Error(
      `[netwarden] SYNC_INTERVAL_SEC has invalid value "${raw}". ` +
        `Expected a positive integer (e.g. 60).`
    );
  }
  return parsed;
}

/**
 * Return the telemetry ingest interval in seconds.
 * Defaults to `300` when TELEMETRY_INGEST_SEC is unset.
 * Throws a clear error if set but not a positive integer.
 */
export function getTelemetryIngestSec(): number {
  const raw = process.env['TELEMETRY_INGEST_SEC'];
  if (raw === undefined || raw === '') return 300;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
    throw new Error(
      `[netwarden] TELEMETRY_INGEST_SEC has invalid value "${raw}". ` +
        `Expected a positive integer (e.g. 300).`
    );
  }
  return parsed;
}

/**
 * Require an env var, throwing a clear error if missing.
 * Use for vars that must be present at the call-site (e.g. JWT_SECRET at token mint).
 */
export function requireEnv(name: keyof AppEnvVars): string {
  const val = name === 'HAZO_ENV' ? getEnv() : process.env[name];
  if (!val) {
    throw new Error(
      `[netwarden] Required environment variable "${name}" is not set. ` +
        `Check your .env file (see .env.example for the full list).`
    );
  }
  return val;
}
