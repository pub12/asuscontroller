import { registerScenario, assertEqual } from 'hazo_ui/test-harness';
registerScenario('scaffold_smoke', {
  name: 'Scaffold — harness loads',
  pkg: 'darylweb',
  cases: [{
    name: 'harness renders and a trivial assertion passes',
    doc: { description: 'Confirms the AutoTest harness mounts and can run a case.', inputs: 'none', expectedOutputs: '1 === 1 passes.', caveats: 'None' },
    run: async () => { assertEqual(1, 1); },
  }],
});

registerScenario('schema_roundtrip', {
  name: 'Schema — all 10 tables + app_devices round-trip',
  pkg: 'darylweb',
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
  pkg: 'darylweb',
  cases: [{
    name: 'superadmin permission resolves; plain user excluded; first-superadmin grant is idempotent; non-matching email is no-op',
    doc: {
      description: [
        'Calls /api/auth-test which spins up isolated in-memory SQLite DBs (hazo_testing),',
        'creates test users via createTestUser, and validates five contract assertions:',
        '(1) a user seeded with darylweb:nw:superadmin is detected as superadmin,',
        '(2) a plain user with darylweb:nw:user is NOT superadmin,',
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
  pkg: 'darylweb',
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
  pkg: 'darylweb',
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
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/settings-gate-test → superadmin_allowed_ok and plain_user_denied_ok both true',
    doc: {
      description: [
        'Calls /api/settings-gate-test which spins up an isolated in-memory SQLite DB (hazo_testing),',
        'creates a superadmin user (with darylweb:nw:superadmin permission) and a plain user',
        '(with darylweb:nw:user permission), then asserts via userHasSuperadmin that:',
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

registerScenario('state_audit_schema', {
  name: 'Schema — hazo_state + hazo_audit tables present',
  pkg: 'darylweb',
  cases: [{
    name: 'migrations create hazo_app_state + 3 hazo_audit tables; hazo_audit_intent round-trip passes',
    doc: {
      description: [
        'Calls /api/state-audit-test which migrates a fresh temp SQLite DB via hazo_connect,',
        'checks all 4 hazo_state/hazo_audit tables exist (hazo_app_state, hazo_audit_outbox,',
        'hazo_audit_field, hazo_audit_intent), and round-trips an insert/findOneBy on',
        'hazo_audit_intent to confirm the table is writable.',
      ].join(' '),
      inputs: 'GET /api/state-audit-test',
      expectedOutputs: 'HTTP 200; all_tables_ok and roundtrip_ok both true.',
      caveats: 'Uses a throwaway temp DB so the dev DB is untouched.',
    },
    run: async () => {
      const res = await fetch('/api/state-audit-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.all_tables_ok, true);
      assertEqual(b.roundtrip_ok, true);
    },
  }],
});

registerScenario('block_sim', {
  name: 'Blocking Core — FakeRouterProvider block simulation',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/block-sim-test → block/unblock/force/capability assertions all pass',
    doc: {
      description: [
        'Calls /api/block-sim-test which exercises a fresh FakeRouterProvider in-memory.',
        'Asserts: (1) initial getBlockState returns false (not blocked) for an unseeded MAC,',
        '(2) setInternetAccess(mac, false) causes getBlockState to return true (blocked),',
        '(3) setInternetAccess(mac, true) causes getBlockState to return false (unblocked),',
        '(4) forceBlockState(mac, true) (drift hook) causes getBlockState to return true,',
        '(5) capabilities().setInternetAccess === true (fake now reports blocking as supported).',
        'Zero network calls — the fake is pure in-memory.',
      ].join(' '),
      inputs: 'GET /api/block-sim-test — no auth required (test-only route).',
      expectedOutputs: [
        'HTTP 200; ok, initial_unblocked, block_ok, unblock_ok, force_ok, cap_ok all true.',
      ].join(' '),
      caveats: 'No DB or network required. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/block-sim-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.initial_unblocked, true);
      assertEqual(b.block_ok, true);
      assertEqual(b.unblock_ok, true);
      assertEqual(b.force_ok, true);
      assertEqual(b.cap_ok, true);
    },
  }],
});

/**
 * block_service — exercises blockDevice / unblockDevice against a temp SQLite DB.
 *
 * Covers: block success, state row write, hazo_state marker CAS, FakeRouterProvider
 * sync, audit outbox capture, intent emission, idempotency (no double-intent on
 * repeat block), unblock lifecycle, offline device rejection, and not-found rejection.
 */
registerScenario('block_service', {
  name: 'Blocking Core — blockDevice / unblockDevice service',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/block-service-test → all block/unblock/guard assertions pass',
    doc: {
      description: [
        'Calls /api/block-service-test which runs the full blockDevice/unblockDevice lifecycle',
        'against a throwaway temp SQLite DB. Asserts:',
        '(block_ok) blockDevice returns blocked=true, routerSynced=true, alreadyInState=false;',
        '(state_row_ok) app_block_state row has is_blocked==1 and correct blocked_by;',
        '(marker_ok) hazo_state key block:d1 holds { blocked: true };',
        '(provider_ok) FakeRouterProvider.getBlockState returns true after block;',
        '(intent_ok) at least one hazo_audit_intent row with event_name=device_blocked, subject_id=d1;',
        '(outbox_ok) at least one hazo_audit_outbox row exists (capture fired);',
        '(idempotent_ok) second blockDevice call returns alreadyInState=true and emits no new intent;',
        '(unblock_ok) unblockDevice leaves is_blocked==0, fake unblocked, device_unblocked intent present;',
        '(offline_reject_ok) blockDevice on an offline device throws BlockServiceError DEVICE_OFFLINE;',
        '(not_found_ok) blockDevice on unknown id throws BlockServiceError NOT_FOUND.',
      ].join(' '),
      inputs: 'GET /api/block-service-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/block-service-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.block_ok, true);
      assertEqual(b.state_row_ok, true);
      assertEqual(b.marker_ok, true);
      assertEqual(b.provider_ok, true);
      assertEqual(b.intent_ok, true);
      assertEqual(b.outbox_ok, true);
      assertEqual(b.idempotent_ok, true);
      assertEqual(b.unblock_ok, true);
      assertEqual(b.offline_reject_ok, true);
      assertEqual(b.not_found_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * block_api — tests the superadmin-gated block/unblock action layer (runBlockAction)
 * including FORBIDDEN enforcement for plain users, block/unblock success paths,
 * idempotency, and error mapping (DEVICE_OFFLINE → VALIDATION_FAILED, NOT_FOUND).
 * All assertions run against an isolated in-memory SQLite DB with FakeRouterProvider.
 */
registerScenario('block_api', {
  name: 'Blocking Core — superadmin-gated block/unblock API action layer',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/block-api-test → all gate + mapping assertions pass',
    doc: {
      description: [
        'Calls /api/block-api-test which spins up an isolated in-memory SQLite DB (hazo_testing),',
        'creates a superadmin user and a plain user, and runs runBlockAction with a FakeRouterProvider.',
        'Asserts: (plain_denied_ok) plain user gets FORBIDDEN; (block_ok) superadmin blocks online device',
        'and fake state flips to true; (idempotent_ok) second block returns alreadyInState=true;',
        '(unblock_ok) superadmin unblocks and fake state flips back; (offline_map_ok) offline device',
        'maps to VALIDATION_FAILED; (not_found_map_ok) unknown device maps to NOT_FOUND.',
      ].join(' '),
      inputs: 'GET /api/block-api-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway in-memory DB; FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/block-api-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.plain_denied_ok, true);
      assertEqual(b.block_ok, true);
      assertEqual(b.idempotent_ok, true);
      assertEqual(b.unblock_ok, true);
      assertEqual(b.offline_map_ok, true);
      assertEqual(b.not_found_map_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * reconcile — drift-reconcile pass in runDeviceSync re-asserts block on the router
 * when the router has lost the rule. Proves: reapplied counter, router re-blocked,
 * router_synced updated, audit intent row emitted, and no redundant reapply on
 * subsequent sync when router is already enforcing the block.
 */
registerScenario('reconcile', {
  name: 'Drift Reconcile — re-apply lost router block rule',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/reconcile-test → drift reapplied, router re-blocked, audit emitted, no redundant reapply',
    doc: {
      description: [
        'Calls /api/reconcile-test which spins up a throwaway temp SQLite DB, inserts device d1',
        'with an app_block_state row (is_blocked=1, router_synced=1), then forces drift via',
        'fake.forceBlockState(mac, false) (router "forgot" the block).',
        'DRIFT case: runDeviceSync re-applies the block (reapplied===1), router is re-blocked',
        '(getBlockState===true), router_synced is set to 1, and a device_block_reapplied intent',
        'row is written to hazo_audit_intent.',
        'NO-DRIFT case: a second runDeviceSync on the already-synced state yields reapplied===0.',
      ].join(' '),
      inputs: 'GET /api/reconcile-test — no auth required (test-only route).',
      expectedOutputs: [
        'HTTP 200; ok true; all_ok true; reapply_ok, router_reblocked_ok, synced_ok,',
        'audit_ok, no_redundant_reapply_ok all true.',
      ].join(' '),
      caveats: 'Uses a throwaway temp DB; FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/reconcile-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.reapply_ok, true);
      assertEqual(b.router_reblocked_ok, true);
      assertEqual(b.synced_ok, true);
      assertEqual(b.audit_ok, true);
      assertEqual(b.no_redundant_reapply_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * audit_drain — full pipeline: block → outbox row → drainOnce → field rows + outbox drained.
 * Proves the hazo_audit_outbox capture + drain lifecycle end-to-end against a temp DB.
 */
registerScenario('audit_drain', {
  name: 'Audit Drain — outbox capture → drainOnce → field rows',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/audit-drain-test → outbox written, drained, field rows present',
    doc: {
      description: [
        'Calls /api/audit-drain-test which spins up a throwaway temp SQLite DB,',
        'inserts online device d1, calls blockDevice (writes an audit outbox row),',
        'then startAuditWorker + drainOnce to process it.',
        'Asserts: (outbox_before_ok) outbox has >=1 row with drained_at null before drain;',
        '(drain_ok) drainOnce returns processed>=1 and failed===0;',
        '(field_ok) hazo_audit_field has >=1 row after drain;',
        '(outbox_drained_ok) every outbox row has non-null drained_at after drain.',
      ].join(' '),
      inputs: 'GET /api/audit-drain-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp DB; FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/audit-drain-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.outbox_before_ok, true);
      assertEqual(b.drain_ok, true);
      assertEqual(b.field_ok, true);
      assertEqual(b.outbox_drained_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * devices_list — mergeBlockState pure helper + block annotation in listDevicesAndGroups.
 * Proves: d1 (is_blocked=1) annotated correctly, d2 (is_blocked=0) annotated correctly,
 * and empty block rows yields all is_blocked===0 (pure helper safety).
 */
registerScenario('devices_list', {
  name: 'Devices List — mergeBlockState block annotation',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/devices-list-test → merged_ok and pure_ok both true',
    doc: {
      description: [
        'Calls /api/devices-list-test which spins up a throwaway temp SQLite DB,',
        'inserts two devices (d1, d2) and app_block_state rows (d1 blocked, d2 not blocked),',
        'then calls mergeBlockState and asserts:',
        '(merged_ok) d1.is_blocked===1 and d2.is_blocked===0 after merge;',
        '(pure_ok) passing [] block rows to mergeBlockState yields all is_blocked===0 (no crash on empty).',
      ].join(' '),
      inputs: 'GET /api/devices-list-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; merged_ok true; pure_ok true.',
      caveats: 'Uses a throwaway temp DB; no network calls.',
    },
    run: async () => {
      const res = await fetch('/api/devices-list-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.merged_ok, true);
      assertEqual(b.pure_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('device_activity', {
  name: 'Device Detail — getDeviceActivity presence + audit timeline',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/device-activity-test → presence aggregation + merged event/field timeline',
    doc: {
      description: [
        'Calls /api/device-activity-test which spins up a throwaway temp SQLite DB, inserts',
        'device d1, runs blockDevice then unblockDevice (real audit intent rows), drains the',
        'audit outbox (producing hazo_audit_field diff rows), seeds app_device_presence',
        '(today=120 min, an earlier day=60 min), then calls getDeviceActivity and asserts:',
        '(presence_today_ok) todayMinutes===120; (presence_all_ok) allTimeMinutes===180;',
        '(timeline_event_ok) both device_blocked and device_unblocked events present;',
        '(timeline_field_ok) at least one kind:field item after the drain;',
        '(sorted_ok) timeline occurred_at is non-increasing.',
      ].join(' '),
      inputs: 'GET /api/device-activity-test — no auth required (test-only route).',
      expectedOutputs: [
        'HTTP 200; ok true; all_ok true; presence_today_ok, presence_all_ok,',
        'timeline_event_ok, timeline_field_ok, sorted_ok all true.',
      ].join(' '),
      caveats: 'Uses a throwaway temp DB; FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/device-activity-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.presence_today_ok, true);
      assertEqual(b.presence_all_ok, true);
      assertEqual(b.timeline_event_ok, true);
      assertEqual(b.timeline_field_ok, true);
      assertEqual(b.sorted_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('sync_test', {
  name: 'Device Sync — full lifecycle (fake provider)',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/sync-test → 10 inserts, 10 updates + presence, 1 offline, 1 new device',
    doc: {
      description: [
        'Calls /api/sync-test which runs three rounds of runDeviceSync against a fresh temp',
        'SQLite DB using FakeRouterProvider (10 seeded devices, zero network calls).',
        'Round 1 (t0): inserts all 10 devices as is_new=1 with first_seen=t0.',
        'Round 2 (t1, +60 s): updates all 10; accrues 1 minute of presence per device',
        '(10 total minutes across app_device_presence).',
        'Round 3 (t2, +120 s): takes device[0] offline and adds one new device;',
        'asserts went_offline===1, the device row status==="offline", inserted===1, is_new===1.',
      ].join(' '),
      inputs: 'GET /api/sync-test — no auth required (test-only route).',
      expectedOutputs: [
        'HTTP 200; ok, first_insert_ok, is_new_ok, first_seen_ok, update_ok,',
        'presence_accrual_ok, offline_ok, new_insert_ok all true.',
      ].join(' '),
      caveats: 'Uses a throwaway temp SQLite DB; FakeRouterProvider makes no network calls.',
    },
    run: async () => {
      const res = await fetch('/api/sync-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.first_insert_ok, true);
      assertEqual(b.is_new_ok, true);
      assertEqual(b.first_seen_ok, true);
      assertEqual(b.update_ok, true);
      assertEqual(b.presence_accrual_ok, true);
      assertEqual(b.offline_ok, true);
      assertEqual(b.new_insert_ok, true);
    },
  }],
});

/**
 * authorize — exercises authorizeCapability against a temp SQLite DB.
 *
 * Covers: superadmin bypass, global grant allow, group-scoped device allow,
 * group-scoped device deny, group action allow, no-grant deny, and audit
 * emission of 'capability_checked' intent with decision='deny'.
 */
registerScenario('authorize', {
  name: 'Permissions — authorizeCapability decision engine',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/authorize-test → all authz decision assertions pass',
    doc: {
      description: [
        'Calls /api/authorize-test which spins up a throwaway temp SQLite DB, inserts test',
        'groups/devices/grants, and runs authorizeCapability for multiple scenarios.',
        'Asserts: (superadmin_allow) superadmin allowed with no grant;',
        '(global_grant_allow) non-superadmin with a global device.block grant allowed for any device;',
        '(group_device_allow) user with device.block grant scoped to g1 allowed for a device in g1;',
        '(group_device_deny) same user denied for a device NOT in g1;',
        '(group_action_allow) user with group.block grant scoped to g1 allowed for group target {scopeId:g1};',
        '(no_grant_deny) user with no grants is denied;',
        '(deny_audited) after a deny, a hazo_audit_intent row with event_name=capability_checked',
        'and payload containing "decision":"deny" exists.',
      ].join(' '),
      inputs: 'GET /api/authorize-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok and *_allow/*_deny flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. Zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/authorize-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.superadmin_allow, true);
      assertEqual(b.global_grant_allow, true);
      assertEqual(b.group_device_allow, true);
      assertEqual(b.group_device_deny, true);
      assertEqual(b.group_action_allow, true);
      assertEqual(b.no_grant_deny, true);
      assertEqual(b.deny_audited, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * grants — exercises grantsService CRUD helpers against a temp SQLite DB.
 *
 * Covers: createGrant, duplicate idempotency, createRequest → approveRequest,
 * createRequest → declineRequest, and revokeGrant lifecycle.
 */
registerScenario('requests_api', {
  name: 'Permissions — requests submit/approve/decline + filterVisibleRequests',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/requests-test → all request lifecycle + visibility assertions pass',
    doc: {
      description: [
        'Calls /api/requests-test which spins up a throwaway temp SQLite DB and exercises',
        'the grantsService request helpers and the pure filterVisibleRequests helper.',
        'Asserts: (submit_ok) createRequest inserts a pending request;',
        '(approve_creates_grant_ok) approveRequest returns a grant, request status becomes "approved",',
        'and findActiveGrants now returns the grant;',
        '(decline_ok) declineRequest sets status "declined", no grant is created;',
        '(revoke_ok) revokeGrant causes findActiveGrants to no longer return the grant;',
        '(superadmin_sees_all_ok) filterVisibleRequests with isSuperadmin:true returns ALL rows;',
        '(user_sees_own_ok) filterVisibleRequests with isSuperadmin:false returns only that user\'s rows.',
      ].join(' '),
      inputs: 'GET /api/requests-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. Zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/requests-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.submit_ok, true);
      assertEqual(b.approve_creates_grant_ok, true);
      assertEqual(b.decline_ok, true);
      assertEqual(b.revoke_ok, true);
      assertEqual(b.superadmin_sees_all_ok, true);
      assertEqual(b.user_sees_own_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('groups_crud', {
  name: 'Groups — CRUD + membership lifecycle',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/groups-test → create, member count, primary assignment, block status, remove, delete all pass',
    doc: {
      description: [
        'Calls /api/groups-test which spins up a throwaway temp SQLite DB and exercises the',
        'full groupService lifecycle.',
        'Asserts: (create_ok) createGroup returns a row with an id and name;',
        '(member_count_ok) after adding 2 devices (one online, one offline), listGroups shows',
        'memberCount===2 and onlineCount===1;',
        '(primary_on_first_add_ok) a device with NULL primary_group_id gets primary_group_id',
        'set to the group after addMembers; a device that already has a primary keeps it;',
        '(block_status_ok) both unblocked → isBlocked false; both blocked → isBlocked true;',
        'one blocked → isBlocked false;',
        '(remove_member_ok) removeMember drops the row and nulls primary_group_id if it pointed',
        'at the group;',
        '(delete_nulls_primary_ok) deleteGroup removes member rows, nulls primary_group_id on',
        'affected devices, and removes the group (getGroup → null).',
      ].join(' '),
      inputs: 'GET /api/groups-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. Zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/groups-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.create_ok, true);
      assertEqual(b.member_count_ok, true);
      assertEqual(b.primary_on_first_add_ok, true);
      assertEqual(b.block_status_ok, true);
      assertEqual(b.remove_member_ok, true);
      assertEqual(b.delete_nulls_primary_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('group_images', {
  name: 'Groups — image upload, store, and serve (local seam)',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/groups-image-test → roundtrip, validation, traversal-safe, missing-null all pass',
    doc: {
      description: [
        'Calls /api/groups-image-test which exercises imageService directly (no HTTP multipart).',
        'Asserts: (roundtrip_ok) storeGroupImage with a 1×1 PNG returns a truthy fileId;',
        'loadGroupImage(fileId, "main") returns non-null buffer and image/* contentType;',
        'loadGroupImage(fileId, "thumb") returns non-null buffer;',
        '(reject_non_image_ok) validateImageUpload with application/pdf → ok===false;',
        '(reject_oversize_ok) validateImageUpload with 99MB image/png → ok===false;',
        '(traversal_safe_ok) loadGroupImage("../../etc/passwd") and loadGroupImage("not-a-uuid") both null;',
        '(missing_returns_null_ok) loadGroupImage with a valid UUID that was never stored → null.',
        'Cleans up stored files in finally block.',
      ].join(' '),
      inputs: 'GET /api/groups-image-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Writes two files temporarily to data/group-images/; deletes them in finally.',
    },
    run: async () => {
      const res = await fetch('/api/groups-image-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.roundtrip_ok, true);
      assertEqual(b.reject_non_image_ok, true);
      assertEqual(b.reject_oversize_ok, true);
      assertEqual(b.traversal_safe_ok, true);
      assertEqual(b.missing_returns_null_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('grants', {
  name: 'Permissions — grantsService CRUD lifecycle',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/grants-test → all grant/request CRUD assertions pass',
    doc: {
      description: [
        'Calls /api/grants-test which spins up a throwaway temp SQLite DB and exercises',
        'the grantsService helpers.',
        'Asserts: (create_grant_ok) createGrant inserts an active grant;',
        '(duplicate_idempotent_ok) createGrant with the same (subject,capability,scope) succeeds',
        'without throwing and leaves exactly one row;',
        '(request_approve_creates_grant_ok) createRequest → approveRequest returns a grant and',
        'request status becomes "approved";',
        '(decline_ok) createRequest → declineRequest sets status "declined", no grant created;',
        '(revoke_ok) revokeGrant sets status "revoked" and findActiveGrants no longer returns it.',
      ].join(' '),
      inputs: 'GET /api/grants-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. Zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/grants-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.create_grant_ok, true);
      assertEqual(b.duplicate_idempotent_ok, true);
      assertEqual(b.request_approve_creates_grant_ok, true);
      assertEqual(b.decline_ok, true);
      assertEqual(b.revoke_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('group_block', {
  name: 'Groups — group block-all/unblock-all + capability guard',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/group-block-test → all group block/unblock + authz assertions pass',
    doc: {
      description: [
        'Calls /api/group-block-test which spins up a throwaway temp SQLite DB, seeds groups',
        'and devices, and exercises runGroupBlockAction with a FakeRouterProvider.',
        'Asserts: (all_offline_skipped_ok) all-offline group → block → affected empty,',
        'skippedOffline = all members, failures empty, isBlocked false;',
        '(partial_block_ok) 2 online + 1 offline → block → affected.length===2,',
        'skippedOffline.length===1, failures empty, isBlocked false;',
        '(all_online_blocked_ok) all-online group → block → affected.length===memberCount,',
        'skippedOffline empty, isBlocked true;',
        '(failure_captured_ok) orphan member (no device row) → block → orphan in failures,',
        'online device in affected;',
        '(unblock_ok) block then unblock all-online group → affected.length===memberCount,',
        'isBlocked false;',
        '(missing_group_ok) nonexistent group → { ok:false, code:NOT_FOUND };',
        '(authorize_group_scope_ok) no grant → allowed false; after createGrant → allowed true.',
      ].join(' '),
      inputs: 'GET /api/group-block-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/group-block-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.all_offline_skipped_ok, true);
      assertEqual(b.partial_block_ok, true);
      assertEqual(b.all_online_blocked_ok, true);
      assertEqual(b.failure_captured_ok, true);
      assertEqual(b.unblock_ok, true);
      assertEqual(b.missing_group_ok, true);
      assertEqual(b.authorize_group_scope_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

registerScenario('notify-events', {
  name: 'Notify Events — domain-event alert mapping helpers',
  pkg: 'darylweb',
  cases: [{
    name: 'device_block, device_unblock, group_block_all, new_devices, zero_noop, escape, unconfigured, schedule_fired all pass',
    doc: {
      description: 'Calls /api/notify-events-test which exercises notifyDeviceBlock, notifyGroupBlockAll, notifyNewDevices, and notifyScheduleFired against recording fake providers. Verifies alert content, zero-count no-op, HTML escaping, unconfigured no-op, and schedule-fired alert shape.',
      inputs: 'GET /api/notify-events-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true including notify_schedule_fired_ok.',
      caveats: 'Uses injected fakes — zero real network calls. Real Telegram delivery is NOT smoke-tested (no token required).',
    },
    run: async () => {
      const res = await fetch('/api/notify-events-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.device_block_alerts_ok, true);
      assertEqual(b.device_unblock_alerts_ok, true);
      assertEqual(b.group_block_all_alerts_ok, true);
      assertEqual(b.new_devices_alerts_ok, true);
      assertEqual(b.new_devices_zero_noop_ok, true);
      assertEqual(b.escapes_label_ok, true);
      assertEqual(b.unconfigured_noop_ok, true);
      assertEqual(b.notify_schedule_fired_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * schedule_timer — createTimer blocks immediately + schedules an unblock.
 */
registerScenario('schedule_timer', {
  name: 'Schedules — createTimer blocks now + schedules unblock',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/schedules-test → timer_ok true',
    doc: {
      description: [
        'Calls /api/schedules-test which spins up a throwaway temp SQLite DB and exercises',
        'the schedules service. Asserts timer_ok: createTimer creates an active one-shot row',
        '(status=active, run_at set, cron=null, job_id set) AND immediately blocks the device',
        '(app_block_state.is_blocked=1, unblock_job_id set in app_block_state).',
      ].join(' '),
      inputs: 'GET /api/schedules-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; timer_ok true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/schedules-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.timer_ok, true);
    },
  }],
});

/**
 * schedule_future_block — createFutureBlock creates a pending one-shot row without blocking now.
 */
registerScenario('schedule_future_block', {
  name: 'Schedules — createFutureBlock pending one-shot, no immediate action',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/schedules-test → future_block_ok true',
    doc: {
      description: [
        'Calls /api/schedules-test and asserts future_block_ok: createFutureBlock creates an',
        'active one-shot row (status=active, run_at=future, cron=null, job_id set) and the',
        'target device is NOT blocked immediately (no app_block_state row with is_blocked=1).',
      ].join(' '),
      inputs: 'GET /api/schedules-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; future_block_ok true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/schedules-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.future_block_ok, true);
    },
  }],
});

/**
 * schedule_fire — runScheduleFire fires a one-shot schedule: device blocked, row → 'done'.
 */
registerScenario('schedule_fire', {
  name: 'Schedules — runScheduleFire fires schedule, device blocked, row done',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/schedules-test → fire_ok true',
    doc: {
      description: [
        'Calls /api/schedules-test and asserts fire_ok: runScheduleFire called directly on',
        'the future_block schedule → result.affected includes the device, app_block_state.is_blocked=1,',
        'and the one-shot schedule row flips to status=done.',
      ].join(' '),
      inputs: 'GET /api/schedules-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; fire_ok true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/schedules-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.fire_ok, true);
    },
  }],
});

/**
 * schedule_recurring — createRecurring creates an active cron row; listSchedules returns it.
 */
registerScenario('schedule_recurring', {
  name: 'Schedules — createRecurring active cron row; listSchedules returns it',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/schedules-test → recurring_ok true',
    doc: {
      description: [
        'Calls /api/schedules-test and asserts recurring_ok: createRecurring creates an active',
        'row (status=active, cron set, run_at=null, job_id set); listSchedules returns it',
        'under the recurring list.',
      ].join(' '),
      inputs: 'GET /api/schedules-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; recurring_ok true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/schedules-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.recurring_ok, true);
    },
  }],
});

/**
 * schedule_early_unblock — manual unblockDevice with jobs cancels pending unblock job + schedule row.
 */
registerScenario('schedule_early_unblock', {
  name: 'Schedules — early unblock cancels pending job + schedule row',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/schedules-test → early_unblock_ok true',
    doc: {
      description: [
        'Calls /api/schedules-test and asserts early_unblock_ok: after createTimer (device blocked',
        'now + unblock job scheduled), calling unblockDevice with { jobs } causes the pending',
        'unblock job to be cancelled (via jobs.cancel) AND the matching app_schedules row to be',
        "marked 'cancelled', and the device is unblocked.",
      ].join(' '),
      inputs: 'GET /api/schedules-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; early_unblock_ok true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeRouterProvider makes zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/schedules-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.early_unblock_ok, true);
    },
  }],
});

/**
 * schedule_authz — authorizeCapability enforces schedule.create for superadmin and non-superadmin.
 */
registerScenario('schedule_authz', {
  name: 'Schedules — authorizeCapability enforces schedule.create',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/schedules-test → schedule_authz_ok true',
    doc: {
      description: [
        'Calls /api/schedules-test and asserts schedule_authz_ok: authorizeCapability with',
        'isSuperadmin:true → allowed=true (reason=superadmin); isSuperadmin:false + no grant',
        '→ allowed=false; isSuperadmin:false + global schedule.create grant → allowed=true.',
      ].join(' '),
      inputs: 'GET /api/schedules-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; schedule_authz_ok true.',
      caveats: 'Uses a throwaway temp SQLite DB. Zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/schedules-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.schedule_authz_ok, true);
    },
  }],
});

registerScenario('notify', {
  name: 'Notify — NotifyProvider ops-alerting seam',
  pkg: 'darylweb',
  cases: [{
    name: 'send, dedupe, swallow, noop-unconfigured checks all pass',
    doc: {
      description: 'Calls /api/notify-test which exercises the NotifyProvider with injected fake transports and clock. Verifies send fires, dedupeKey suppresses within window and re-fires after, no-dedupeKey always sends, errors are swallowed, and the unconfigured path is a no-op.',
      inputs: 'GET /api/notify-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses injected fakes — zero real network calls. Robust whether or not TELEGRAM_* env vars are set.',
    },
    run: async () => {
      const res = await fetch('/api/notify-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.sends_when_configured_ok, true);
      assertEqual(b.dedupe_suppresses_ok, true);
      assertEqual(b.no_dedupe_key_always_sends_ok, true);
      assertEqual(b.swallows_send_errors_ok, true);
      assertEqual(b.noop_unconfigured_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * retention — pruneEvents deletes stale raw domain events, leaves rollup tables intact.
 *
 * Covers: pure computeCutoff, deleted count, old rows gone, recent rows kept,
 * app_domain_rollup_daily untouched, app_device_presence untouched.
 */
registerScenario('retention', {
  name: 'Retention Pruning — raw domain events pruned, rollups untouched',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/retention-test → all pruning + isolation assertions pass',
    doc: {
      description: [
        'Calls /api/retention-test which spins up a throwaway temp SQLite DB, inserts',
        'two OLD domain events (60 days ago) and two RECENT events (1 day ago),',
        'plus two app_domain_rollup_daily rows and one app_device_presence row,',
        'then calls pruneEvents with retentionDays=30 and a fixed now.',
        'Asserts: (cutoff_is_pure_ok) computeCutoff(2026-01-31, 30) === "2026-01-01T00:00:00.000Z";',
        '(deleted_count_ok) returned deleted===2;',
        '(old_rows_gone_ok) no app_domain_events rows with ts < cutoff remain;',
        '(recent_rows_kept_ok) two recent events still present;',
        '(rollups_untouched_ok) app_domain_rollup_daily count unchanged (===2);',
        '(presence_untouched_ok) app_device_presence count unchanged (===1).',
      ].join(' '),
      inputs: 'GET /api/retention-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. Zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/retention-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.cutoff_is_pure_ok, true);
      assertEqual(b.deleted_count_ok, true);
      assertEqual(b.old_rows_gone_ok, true);
      assertEqual(b.recent_rows_kept_ok, true);
      assertEqual(b.rollups_untouched_ok, true);
      assertEqual(b.presence_untouched_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});

/**
 * telemetry_ingest — runTelemetryIngest full lifecycle against a temp SQLite DB.
 *
 * Covers: cold-start 24h backfill insert (39 events), unknown-MAC rejection (no orphan row),
 * idempotent re-ingest (composite-PK dedupe), blocked-flag persistence (4 rows),
 * and not-configured provider graceful no-op.
 */
registerScenario('telemetry_ingest', {
  name: 'Telemetry Ingest — cold start, dedupe, unknown-MAC, blocked flag, not-configured no-op',
  pkg: 'darylweb',
  cases: [{
    name: 'GET /api/ingest-test → all 6 ingest lifecycle assertions pass',
    doc: {
      description: [
        'Calls /api/ingest-test which spins up a throwaway temp SQLite DB, seeds 10 device rows',
        'via runDeviceSync, and runs three rounds of runTelemetryIngest with a FakeTelemetryProvider.',
        'Asserts: (initial_insert_ok) first ingest with cold table covers the 24h backfill window,',
        'inserts all 39 seed events (configured=true, inserted===39, skipped===0, count===39);',
        '(fetched_ok) provider returned 40 events total (39 seed + 1 injected unknown-MAC event);',
        '(unknown_mac_ok) the unknown-MAC event is counted (unknown_mac===1) but no orphan row',
        'is written to app_domain_events (domain "unknown-device.example" count===0);',
        '(reingest_dedupe_ok) second ingest is idempotent: inserted===0, skipped>=1, total count',
        'unchanged at 39 (composite-PK "dom_"+mac+"_"+ts+"_"+domain deduplicates);',
        '(blocked_persisted_ok) exactly 4 app_domain_events rows have blocked=1 (all doubleclick.net);',
        '(not_configured_ok) inline stub provider returning configured:false → configured===false,',
        'fetched===0, inserted===0, event count still 39 (graceful no-op).',
      ].join(' '),
      inputs: 'GET /api/ingest-test — no auth required (test-only route).',
      expectedOutputs: 'HTTP 200; ok true; all_ok true; all individual *_ok flags true.',
      caveats: 'Uses a throwaway temp SQLite DB. FakeTelemetryProvider and FakeRouterProvider make zero network calls.',
    },
    run: async () => {
      const res = await fetch('/api/ingest-test');
      const b = await res.json();
      assertEqual(res.status, 200);
      assertEqual(b.ok, true);
      assertEqual(b.initial_insert_ok, true);
      assertEqual(b.fetched_ok, true);
      assertEqual(b.unknown_mac_ok, true);
      assertEqual(b.reingest_dedupe_ok, true);
      assertEqual(b.blocked_persisted_ok, true);
      assertEqual(b.not_configured_ok, true);
      assertEqual(b.all_ok, true);
    },
  }],
});
