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
