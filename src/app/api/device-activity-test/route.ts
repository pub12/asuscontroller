/**
 * src/app/api/device-activity-test/route.ts
 *
 * Hermetic autotest for getDeviceActivity (Phase 7 — Device Detail Screen).
 *
 * Lifecycle:
 * 1. Spin up a throwaway temp SQLite DB and run all migrations.
 * 2. Insert one online device d1.
 * 3. Produce real audit rows via blockDevice + unblockDevice (writes intent rows).
 * 4. Drain the outbox once via startAuditWorker to produce hazo_audit_field rows.
 * 5. Seed app_device_presence with two rows: today=120min, older day=60min.
 * 6. Call getDeviceActivity(adapter, 'd1', todayIso).
 * 7. Assert:
 *    - presence_today_ok:  todayMinutes === 120
 *    - presence_all_ok:    allTimeMinutes === 180
 *    - timeline_event_ok:  timeline has both a device_blocked and device_unblocked event
 *    - timeline_field_ok:  at least one kind:'field' item (drain result)
 *    - sorted_ok:          timeline occurred_at is non-increasing (DESC)
 * 8. Return JSON + all_ok.
 *
 * Registers the `device_activity` scenario in the /autotest harness.
 * Returns 404 in production.
 */

import { createHazoConnect, runMigrations, createCrudService } from 'hazo_connect/server';
import { startAuditWorker } from 'hazo_audit/server';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { blockDevice, unblockDevice } from '@/server/devices/blockService';
import { getDeviceActivity } from '@/server/devices/deviceActivity';
import os from 'os';
import path from 'path';
import fs from 'fs';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const tmpDb = path.join(
    os.tmpdir(),
    `darylweb_device_activity_test_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`,
  );

  try {
    const adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: { database_path: tmpDb, driver: 'better-sqlite3' },
    });

    // 1. Run all migrations.
    await runMigrations(adapter, { directory: MIGRATIONS_DIR });

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);

    // Derive an older day (6 days ago) for the second presence row.
    const olderDate = new Date();
    olderDate.setDate(olderDate.getDate() - 6);
    const olderDayIso = olderDate.toISOString().slice(0, 10);

    // 2. Insert one online device d1.
    await createCrudService(adapter, 'app_devices').insert({
      id: 'd1',
      mac: 'AA:BB:CC:00:00:07',
      status: 'online',
      last_seen: nowIso,
    });

    // 3. Produce real audit rows: block then unblock d1.
    const fake = new FakeRouterProvider();
    await blockDevice(adapter, fake, 'd1', {
      actor: { label: 'tester', userId: null },
      reason: 't7',
    });
    await unblockDevice(adapter, fake, 'd1', {
      actor: { label: 'tester', userId: null },
    });

    // 4. Drain outbox once to produce hazo_audit_field rows.
    const w = startAuditWorker({ app_adapter: adapter });
    const drained = await w.drainOnce();
    await w.stop();

    const drain_processed = drained.processed;
    const drain_failed = drained.failed;

    // 5. Seed app_device_presence.
    await createCrudService(adapter, 'app_device_presence', {
      primaryKeys: ['device_id', 'day'],
      autoId: false,
    }).insert({ device_id: 'd1', day: todayIso, connected_minutes: 120 });

    await createCrudService(adapter, 'app_device_presence', {
      primaryKeys: ['device_id', 'day'],
      autoId: false,
    }).insert({ device_id: 'd1', day: olderDayIso, connected_minutes: 60 });

    // 6. Call getDeviceActivity.
    const act = await getDeviceActivity(adapter, 'd1', todayIso);

    // 7. Assertions.
    const presence_today_ok = act.presence.todayMinutes === 120;
    const presence_all_ok = act.presence.allTimeMinutes === 180;

    const hasBlocked = act.timeline.some(
      (t) => t.kind === 'event' && t.event_name === 'device_blocked',
    );
    const hasUnblocked = act.timeline.some(
      (t) => t.kind === 'event' && t.event_name === 'device_unblocked',
    );
    const timeline_event_ok = hasBlocked && hasUnblocked;

    const fieldItems = act.timeline.filter((t) => t.kind === 'field');
    const timeline_field_ok = fieldItems.length >= 1;

    let sorted_ok = true;
    for (let i = 1; i < act.timeline.length; i++) {
      if (act.timeline[i].occurred_at > act.timeline[i - 1].occurred_at) {
        sorted_ok = false;
        break;
      }
    }

    const all_ok =
      presence_today_ok &&
      presence_all_ok &&
      timeline_event_ok &&
      timeline_field_ok &&
      sorted_ok;

    return Response.json({
      ok: true,
      all_ok,
      presence_today_ok,
      presence_all_ok,
      timeline_event_ok,
      timeline_field_ok,
      sorted_ok,
      drain_processed,
      drain_failed,
      _timeline_length: act.timeline.length,
      _field_items_count: fieldItems.length,
      _today_iso: todayIso,
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
