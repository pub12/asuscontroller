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
  };
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
