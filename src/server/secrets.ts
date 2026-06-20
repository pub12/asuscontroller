/**
 * src/server/secrets.ts — Server-only secret accessors for NetWarden.
 *
 * Uses LookupSecretsProvider (hazo_secure/secrets) so we read plain env var
 * names (ROUTER_HOST, ROUTER_USER, etc.) without requiring the HAZO_SECRET_
 * prefix convention.  This matches the .env.example layout — each var keeps
 * its natural name.
 *
 * Field encryption uses EnvKeyProvider (hazo_secure/crypto) backed by two
 * env vars:
 *   HAZO_FIELD_KEY_CURRENT  — the active key id (e.g. "v1")
 *   HAZO_FIELD_KEY_v1       — base64-encoded 32-byte AES-256 key material
 *
 * DO NOT import this module from any Client Component or shared lib.
 * It only runs on the server (API routes, Server Components, scripts).
 */
import 'server-only';
import { LookupSecretsProvider } from 'hazo_secure/secrets';
import { EnvKeyProvider, encryptField, decryptField } from 'hazo_secure/crypto';
import type { EncryptedField } from 'hazo_secure/crypto';

// ---------------------------------------------------------------------------
// Secrets provider — plain env var names, no HAZO_SECRET_ prefix needed
// ---------------------------------------------------------------------------

const secretsProvider = new LookupSecretsProvider(
  (name: string) => process.env[name]
);

// ---------------------------------------------------------------------------
// Router credentials
// ---------------------------------------------------------------------------

/**
 * Return ASUS ZenWiFi router credentials from environment.
 * Used only by staged spike scripts — never called unattended.
 * Returns `undefined` values when env vars are not set.
 */
export async function getRouterCredentials(): Promise<{
  host: string | undefined;
  user: string | undefined;
  pass: string | undefined;
}> {
  return {
    host: process.env['ROUTER_HOST'],
    user: process.env['ROUTER_USER'],
    pass: process.env['ROUTER_PASS'],
  };
}

// ---------------------------------------------------------------------------
// Telemetry key
// ---------------------------------------------------------------------------

/**
 * Return the NextDNS API key, or null when not configured.
 * Never throws — callers should handle the null case gracefully.
 */
export async function getTelemetryKey(): Promise<string | null> {
  try {
    const key = await secretsProvider.get('NEXTDNS_API_KEY');
    return key || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Field encryption — EnvKeyProvider
//
// Key naming convention (prefix = "HAZO_FIELD_KEY"):
//   HAZO_FIELD_KEY_CURRENT=v1
//   HAZO_FIELD_KEY_v1=<base64 of 32 bytes>
// ---------------------------------------------------------------------------

const fieldKeys = new EnvKeyProvider('HAZO_FIELD_KEY');

/**
 * Encrypt a string value for storage (e.g. in a sensitive DB column).
 * Returns the EncryptedField envelope — store as JSON in a text/jsonb column.
 */
export async function encryptSecret(value: string): Promise<EncryptedField> {
  return encryptField(value, { keys: fieldKeys });
}

/**
 * Decrypt a previously-encrypted field.
 * Throws CryptoError if the key is missing or the ciphertext is tampered.
 */
export async function decryptSecret(field: EncryptedField): Promise<string> {
  return decryptField(field, { keys: fieldKeys });
}
