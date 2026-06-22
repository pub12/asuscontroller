/**
 * GET /api/secret-test
 *
 * Smoke-test that hazo_secure secrets and field crypto are correctly wired.
 * This route is server-only — secrets never reach the client bundle.
 *
 * It:
 *  1. Sets a temporary env var in-process, reads it back through secrets.ts,
 *     and verifies the round-trip (secret_roundtrip_ok).
 *  2. Round-trips a plaintext value through encryptSecret / decryptSecret
 *     to confirm the EnvKeyProvider + AES-GCM pipeline works (crypto_roundtrip_ok).
 *
 * For the crypto round-trip we use a StaticKeyProvider wrapper so the test
 * runs without real key material in the environment — this keeps the test
 * self-contained and avoids requiring HAZO_FIELD_KEY_* to be set.
 *
 * Returns: { ok, secret_roundtrip_ok, crypto_roundtrip_ok }
 * On error: { ok: false, error: string } with status 500.
 */
import { LookupSecretsProvider } from 'hazo_secure/secrets';
import { encryptField, decryptField, StaticKeyProvider } from 'hazo_secure/crypto';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    // --- Secret round-trip ---
    // Set a temporary env var, read it back through a LookupSecretsProvider.
    const TEST_VAR = '__DARYLWEB_SECRET_TEST__';
    const TEST_VAL = 'darylweb-secret-smoke-' + Date.now();
    process.env[TEST_VAR] = TEST_VAL;

    const provider = new LookupSecretsProvider((name) => process.env[name]);
    const resolved = await provider.get(TEST_VAR);
    const secret_roundtrip_ok = resolved === TEST_VAL;

    // Clean up — don't leave test var in process.env
    delete process.env[TEST_VAR];

    // --- Crypto round-trip ---
    // Use a StaticKeyProvider so the test is self-contained (no HAZO_FIELD_KEY_* required).
    const testKeyBytes = new Uint8Array(32).fill(0x42); // deterministic test key
    const keys = new StaticKeyProvider('smoke-v1', { 'smoke-v1': testKeyBytes });

    const plaintext = 'darylweb-crypto-smoke';
    const encrypted = await encryptField(plaintext, { keys });
    const decrypted = await decryptField(encrypted, { keys });
    const crypto_roundtrip_ok = decrypted === plaintext;

    return Response.json({ ok: true, secret_roundtrip_ok, crypto_roundtrip_ok });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
