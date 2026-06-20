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
