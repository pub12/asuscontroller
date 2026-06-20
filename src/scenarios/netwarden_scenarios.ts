import { registerScenario, assertEqual } from 'hazo_ui/test-harness';
registerScenario('scaffold_smoke', {
  name: 'Scaffold — harness loads',
  pkg: 'netwarden',
  cases: [{
    name: 'harness renders and a trivial assertion passes',
    doc: { description: 'Confirms the AutoTest harness mounts and can run a case.', inputs: 'none', expectedOutputs: '1 === 1 passes.', caveats: 'None' },
    run: async () => { assertEqual(1, 1); },
  }],
});

registerScenario('schema_roundtrip', {
  name: 'Schema — all 10 tables + app_devices round-trip',
  pkg: 'netwarden',
  cases: [{
    name: 'migrations create all 10 app_ tables; app_devices insert/select round-trips; re-run idempotent',
    doc: {
      description: 'Calls /api/schema-test which migrates a fresh temp SQLite DB twice via hazo_connect, checks all 10 app_ tables exist, round-trips an app_devices insert/select, and confirms the second migration run is a no-op.',
      inputs: 'GET /api/schema-test',
      expectedOutputs: 'HTTP 200; all_tables_ok, roundtrip_ok, idempotent_ok all true.',
      caveats: 'Uses a throwaway temp DB so the dev DB is untouched.',
    },
    run: async () => {
      const res = await fetch('/api/schema-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.all_tables_ok, true);
      assertEqual(b.roundtrip_ok, true);
      assertEqual(b.idempotent_ok, true);
    },
  }],
});

registerScenario('auth_roles', {
  name: 'Auth — role/permission resolution + first-superadmin',
  pkg: 'netwarden',
  cases: [{
    name: 'superadmin permission resolves; plain user excluded; first-superadmin grant is idempotent; non-matching email is no-op',
    doc: {
      description: [
        'Calls /api/auth-test which spins up isolated in-memory SQLite DBs (hazo_testing),',
        'creates test users via createTestUser, and validates five contract assertions:',
        '(1) a user seeded with netwarden:nw:superadmin is detected as superadmin,',
        '(2) a plain user with netwarden:nw:user is NOT superadmin,',
        '(3) ensureFirstSuperadmin grants the permission when no holder exists,',
        '(4) a second call is a no-op (no duplicate rows),',
        '(5) calling with a non-matching email does nothing.',
      ].join(' '),
      inputs: 'GET /api/auth-test',
      expectedOutputs: 'HTTP 200; ok, superadmin_resolves_ok, plain_user_not_superadmin_ok, first_superadmin_grant_ok, idempotent_ok, non_matching_noop_ok all true.',
      caveats: 'Uses throwaway in-memory DBs; JWT_SECRET must be set (or hazo_testing provides a default).',
    },
    run: async () => {
      const res = await fetch('/api/auth-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.superadmin_resolves_ok, true);
      assertEqual(b.plain_user_not_superadmin_ok, true);
      assertEqual(b.first_superadmin_grant_ok, true);
      assertEqual(b.idempotent_ok, true);
      assertEqual(b.non_matching_noop_ok, true);
    },
  }],
});

registerScenario('api_foundation', {
  name: 'API Foundation — envelopes, OpenAPI, Swagger UI',
  pkg: 'netwarden',
  // Note: authenticated /api/me returning roles is proven by the auth_roles resolver
  // test (/api/auth-test); we only test the unauthenticated 401 path here.
  cases: [
    {
      name: 'GET /api/health → 200 ok envelope with meta',
      doc: {
        description: 'Confirms /api/health returns an ok envelope (ok: true, data.status: "ok") with hazo_api meta fields: request_id matching /^req_/ and elapsed_ms as a number.',
        inputs: 'GET /api/health — no auth required.',
        expectedOutputs: 'HTTP 200; body.ok === true; body.data.status === "ok"; body.meta.request_id matches /^req_/; typeof body.meta.elapsed_ms === "number".',
        caveats: 'None — deterministic and always reachable.',
      },
      run: async () => {
        const res = await fetch('/api/health');
        const body = await res.json();
        assertEqual(res.status, 200);
        assertEqual(body.ok, true);
        assertEqual(body.data.status, 'ok');
        assertEqual(typeof body.meta.request_id === 'string' && /^req_/.test(body.meta.request_id), true);
        assertEqual(typeof body.meta.elapsed_ms, 'number');
      },
    },
    {
      name: 'GET /api/me unauthenticated → 401 UNAUTHORIZED',
      doc: {
        description: 'Confirms /api/me returns a 401 fail envelope with error.code === "UNAUTHORIZED" when called without an auth session.',
        inputs: 'GET /api/me — no session cookie.',
        expectedOutputs: 'HTTP 401; body.ok === false; body.error.code === "UNAUTHORIZED".',
        caveats: 'Requires the browser to have no active hazo_auth session. Authed /api/me is covered by the auth_roles scenario.',
      },
      run: async () => {
        const res = await fetch('/api/me');
        const body = await res.json();
        assertEqual(res.status, 401);
        assertEqual(body.ok, false);
        assertEqual(body.error.code, 'UNAUTHORIZED');
      },
    },
    {
      name: 'GET /api/v1/docs → OpenAPI 3.1 spec with non-empty paths',
      doc: {
        description: 'Confirms /api/v1/docs returns a valid OpenAPI 3.1 JSON spec (not an envelope) with at least one path defined.',
        inputs: 'GET /api/v1/docs — no auth required.',
        expectedOutputs: 'HTTP 200; body.openapi starts with "3.1"; Object.keys(body.paths).length > 0.',
        caveats: 'None — spec is generated statically from ALL_ROUTES.',
      },
      run: async () => {
        const res = await fetch('/api/v1/docs');
        const body = await res.json();
        assertEqual(res.status, 200);
        assertEqual(String(body.openapi).startsWith('3.1'), true);
        assertEqual(Object.keys(body.paths).length > 0, true);
      },
    },
    {
      name: 'GET /api/v1/docs/ui → HTML containing swagger',
      doc: {
        description: 'Confirms /api/v1/docs/ui returns HTML (text/html content-type) that includes Swagger UI markup.',
        inputs: 'GET /api/v1/docs/ui — no auth required.',
        expectedOutputs: 'HTTP 200; Content-Type starts with "text/html"; body text matches /swagger/i.',
        caveats: 'None — Swagger UI HTML is generated by hazo_api/client.',
      },
      run: async () => {
        const res = await fetch('/api/v1/docs/ui');
        const text = await res.text();
        assertEqual(res.status, 200);
        assertEqual(res.headers.get('content-type')?.startsWith('text/html') ?? false, true);
        assertEqual(/swagger/i.test(text), true);
      },
    },
  ],
});

registerScenario('secure_smoke', {
  name: 'Secure — secrets server-only + crypto round-trip',
  pkg: 'netwarden',
  // Top-level doc: secrets are resolved server-side only and never bundled to the client.
  // The hazo_secure LookupSecretsProvider reads plain env var names; field crypto uses
  // EnvKeyProvider (prefix HAZO_FIELD_KEY) for AES-256-GCM envelope encryption.
  cases: [{
    name: 'GET /api/secret-test → secret round-trip and AES-GCM round-trip both pass',
    doc: {
      description: [
        'Calls /api/secret-test which (1) sets a temporary env var in-process, reads it back',
        'through a LookupSecretsProvider, and verifies the value matches (secret_roundtrip_ok),',
        'and (2) round-trips a plaintext string through encryptField/decryptField using a',
        'StaticKeyProvider (self-contained; no HAZO_FIELD_KEY_* vars required) (crypto_roundtrip_ok).',
        'Secrets are resolved on the server only — this route does NOT export anything to the client bundle.',
      ].join(' '),
      inputs: 'GET /api/secret-test — no auth required.',
      expectedOutputs: 'HTTP 200; body.ok === true; body.secret_roundtrip_ok === true; body.crypto_roundtrip_ok === true.',
      caveats: 'Uses StaticKeyProvider for the crypto leg so no real HAZO_FIELD_KEY_* vars are required in dev.',
    },
    run: async () => {
      const res = await fetch('/api/secret-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.secret_roundtrip_ok, true);
      assertEqual(b.crypto_roundtrip_ok, true);
    },
  }],
});

registerScenario('settings_gate', {
  name: 'Settings — superadmin gate allows superadmin, denies plain user',
  pkg: 'netwarden',
  cases: [{
    name: 'GET /api/settings-gate-test → superadmin_allowed_ok and plain_user_denied_ok both true',
    doc: {
      description: [
        'Calls /api/settings-gate-test which spins up an isolated in-memory SQLite DB (hazo_testing),',
        'creates a superadmin user (with netwarden:nw:superadmin permission) and a plain user',
        '(with netwarden:nw:user permission), then asserts via userHasSuperadmin that:',
        '(1) the superadmin is detected as superadmin (superadmin_allowed_ok),',
        '(2) the plain user is NOT detected as superadmin (plain_user_denied_ok).',
        'This validates the gate logic used by the Settings server component.',
      ].join(' '),
      inputs: 'GET /api/settings-gate-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; body.ok === true; body.superadmin_allowed_ok === true; body.plain_user_denied_ok === true.',
      caveats: 'Uses a throwaway in-memory DB; JWT_SECRET must be set or hazo_testing provides a default.',
    },
    run: async () => {
      const res = await fetch('/api/settings-gate-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.superadmin_allowed_ok, true);
      assertEqual(b.plain_user_denied_ok, true);
    },
  }],
});
