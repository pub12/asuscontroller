/**
 * src/app/api/notify-events-test/route.ts
 *
 * Hermetic test for notify event helpers (events.ts).
 * Uses recording fake providers — zero real network calls.
 *
 * Returns 404 in production.
 */

import { createNotifyProvider } from '@/server/notify/NotifyProvider';
import { notifyDeviceBlock, notifyGroupBlockAll, notifyNewDevices } from '@/server/notify/events';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  try {
    // -------------------------------------------------------------------------
    // Check 1: device_block_alerts_ok
    // notifyDeviceBlock(block) → one send containing 'blocked', device label, actor
    // -------------------------------------------------------------------------
    let device_block_alerts_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({ send: async (text) => { calls.push(text); } });
      await notifyDeviceBlock(provider, { action: 'block', deviceLabel: 'MyDevice', actor: 'alice' });
      device_block_alerts_ok =
        calls.length === 1 &&
        calls[0].includes('blocked') &&
        calls[0].includes('MyDevice') &&
        calls[0].includes('alice');
    }

    // -------------------------------------------------------------------------
    // Check 2: device_unblock_alerts_ok
    // notifyDeviceBlock(unblock) → send containing 'unblocked'
    // -------------------------------------------------------------------------
    let device_unblock_alerts_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({ send: async (text) => { calls.push(text); } });
      await notifyDeviceBlock(provider, { action: 'unblock', deviceLabel: 'MyDevice', actor: 'bob' });
      device_unblock_alerts_ok =
        calls.length === 1 &&
        calls[0].includes('unblocked');
    }

    // -------------------------------------------------------------------------
    // Check 3: group_block_all_alerts_ok
    // notifyGroupBlockAll(block, memberCount 3, affectedCount 2) → 'block-all' and '2/3'
    // -------------------------------------------------------------------------
    let group_block_all_alerts_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({ send: async (text) => { calls.push(text); } });
      await notifyGroupBlockAll(provider, {
        action: 'block',
        groupId: 'g1',
        memberCount: 3,
        affectedCount: 2,
        actor: 'carol',
      });
      group_block_all_alerts_ok =
        calls.length === 1 &&
        calls[0].includes('block-all') &&
        calls[0].includes('2/3');
    }

    // -------------------------------------------------------------------------
    // Check 4: new_devices_alerts_ok
    // notifyNewDevices(count 4) → send containing '4'
    // -------------------------------------------------------------------------
    let new_devices_alerts_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({ send: async (text) => { calls.push(text); } });
      await notifyNewDevices(provider, { count: 4 });
      new_devices_alerts_ok =
        calls.length === 1 &&
        calls[0].includes('4');
    }

    // -------------------------------------------------------------------------
    // Check 5: new_devices_zero_noop_ok
    // notifyNewDevices(count 0) → fake send NOT called
    // -------------------------------------------------------------------------
    let new_devices_zero_noop_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({ send: async (text) => { calls.push(text); } });
      await notifyNewDevices(provider, { count: 0 });
      new_devices_zero_noop_ok = calls.length === 0;
    }

    // -------------------------------------------------------------------------
    // Check 6: escapes_label_ok
    // deviceLabel containing '<script>' → recorded text does NOT contain '<script>'
    // -------------------------------------------------------------------------
    let escapes_label_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({ send: async (text) => { calls.push(text); } });
      await notifyDeviceBlock(provider, { action: 'block', deviceLabel: '<script>alert(1)</script>', actor: 'eve' });
      escapes_label_ok =
        calls.length === 1 &&
        !calls[0].includes('<script>');
    }

    // -------------------------------------------------------------------------
    // Check 7: unconfigured_noop_ok
    // A helper called against createNotifyProvider() (default send, env unset)
    // resolves without throwing.
    // -------------------------------------------------------------------------
    let unconfigured_noop_ok = false;
    {
      const provider = createNotifyProvider();
      let threw = false;
      try {
        await notifyDeviceBlock(provider, { action: 'block', deviceLabel: 'X', actor: 'Y' });
      } catch {
        threw = true;
      }
      unconfigured_noop_ok = !threw;
    }

    const all_ok =
      device_block_alerts_ok &&
      device_unblock_alerts_ok &&
      group_block_all_alerts_ok &&
      new_devices_alerts_ok &&
      new_devices_zero_noop_ok &&
      escapes_label_ok &&
      unconfigured_noop_ok;

    return Response.json({
      ok: true,
      all_ok,
      device_block_alerts_ok,
      device_unblock_alerts_ok,
      group_block_all_alerts_ok,
      new_devices_alerts_ok,
      new_devices_zero_noop_ok,
      escapes_label_ok,
      unconfigured_noop_ok,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
