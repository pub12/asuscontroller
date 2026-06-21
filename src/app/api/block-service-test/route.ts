import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { HazoState } from 'hazo_state/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { blockDevice, unblockDevice, BlockServiceError } from '@/server/devices/blockService';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  const tmpDb = path.join(os.tmpdir(), `netwarden_block_service_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`);

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: tmpDb,
        driver: 'better-sqlite3',
      },
    });

    // 1. Run all migrations
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    // 2. Insert test devices
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd1', mac: 'AA:BB:CC:00:00:99', status: 'online',
    });
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd2', mac: 'AA:BB:CC:00:00:98', status: 'offline',
    });

    // 3. Create the fake router provider
    const fake = new FakeRouterProvider();

    // 4. Call blockDevice on d1
    const blockResult = await blockDevice(adapter, fake, 'd1', {
      actor: { label: 'tester@example.com' },
      reason: 'test-block',
    });

    // 5. Build assertions

    // block_ok: result indicates blocked, synced, not already in state
    const block_ok =
      blockResult.blocked === true &&
      blockResult.routerSynced === true &&
      blockResult.alreadyInState === false;

    // state_row_ok: app_block_state row for d1 has is_blocked == 1 and blocked_by == 'tester@example.com'
    const stateRow = await createCrudService(adapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false }).findById('d1') as Record<string, unknown> | null;
    const state_row_ok =
      stateRow !== null &&
      Number(stateRow.is_blocked) === 1 &&
      stateRow.blocked_by === 'tester@example.com';

    // marker_ok: hazo_state has block:d1 = { blocked: true }
    const stateEntry = await new HazoState(adapter).get('block:d1');
    const markerValue = stateEntry?.value as { blocked?: boolean } | null | undefined;
    const marker_ok = markerValue?.blocked === true;

    // provider_ok: fake.getBlockState returns true for the MAC
    const fakeBlocked = await fake.getBlockState('AA:BB:CC:00:00:99');
    const provider_ok = fakeBlocked === true;

    // intent_ok: at least one hazo_audit_intent row for device_blocked / d1
    const intentRows = await createCrudService(adapter, 'hazo_audit_intent').findBy({
      event_name: 'device_blocked',
      subject_id: 'd1',
    });
    const intent_ok = intentRows.length >= 1;
    const intentCountAfterBlock = intentRows.length;

    // outbox_ok: at least one hazo_audit_outbox row
    const outboxRows = await createCrudService(adapter, 'hazo_audit_outbox').list();
    const outbox_count = outboxRows.length;
    const outbox_ok = outbox_count >= 1;

    // idempotent_ok: second blockDevice call returns alreadyInState === true and does NOT emit a new intent
    const blockResult2 = await blockDevice(adapter, fake, 'd1', {
      actor: { label: 'tester@example.com' },
      reason: 'test-block',
    });
    const intentRowsAfterIdempotent = await createCrudService(adapter, 'hazo_audit_intent').findBy({
      event_name: 'device_blocked',
      subject_id: 'd1',
    });
    const idempotent_ok =
      blockResult2.alreadyInState === true &&
      intentRowsAfterIdempotent.length === intentCountAfterBlock;

    // unblock_ok: unblockDevice returns blocked===false; state is_blocked==0; fake shows unblocked; intent row exists
    const unblockResult = await unblockDevice(adapter, fake, 'd1', {
      actor: { label: 'tester@example.com' },
    });
    const unblockStateRow = await createCrudService(adapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false }).findById('d1') as Record<string, unknown> | null;
    const fakeUnblocked = await fake.getBlockState('AA:BB:CC:00:00:99');
    const unblockIntentRows = await createCrudService(adapter, 'hazo_audit_intent').findBy({
      event_name: 'device_unblocked',
      subject_id: 'd1',
    });
    const unblock_ok =
      unblockResult.blocked === false &&
      unblockStateRow !== null &&
      Number(unblockStateRow.is_blocked) === 0 &&
      fakeUnblocked === false &&
      unblockIntentRows.length >= 1;

    // offline_reject_ok: blockDevice on d2 (offline) throws BlockServiceError code 'DEVICE_OFFLINE'
    let offline_reject_ok = false;
    try {
      await blockDevice(adapter, fake, 'd2', { actor: { label: 'tester@example.com' } });
    } catch (e) {
      if (e instanceof BlockServiceError && e.code === 'DEVICE_OFFLINE') {
        offline_reject_ok = true;
      }
    }

    // not_found_ok: blockDevice on 'nope' throws BlockServiceError code 'NOT_FOUND'
    let not_found_ok = false;
    try {
      await blockDevice(adapter, fake, 'nope', { actor: { label: 'tester@example.com' } });
    } catch (e) {
      if (e instanceof BlockServiceError && e.code === 'NOT_FOUND') {
        not_found_ok = true;
      }
    }

    const all_ok =
      block_ok &&
      state_row_ok &&
      marker_ok &&
      provider_ok &&
      intent_ok &&
      outbox_ok &&
      idempotent_ok &&
      unblock_ok &&
      offline_reject_ok &&
      not_found_ok;

    return Response.json({
      ok: true,
      all_ok,
      block_ok,
      state_row_ok,
      marker_ok,
      provider_ok,
      intent_ok,
      outbox_ok,
      outbox_count,
      idempotent_ok,
      unblock_ok,
      offline_reject_ok,
      not_found_ok,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    } catch {
      // best-effort cleanup
    }
  }
}
