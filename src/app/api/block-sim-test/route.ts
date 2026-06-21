import { FakeRouterProvider } from '../../../server/router/FakeRouterProvider';

export async function GET() {
  try {
    const p = new FakeRouterProvider();
    const mac = 'AA:BB:CC:00:00:02';

    // initial: device has never been explicitly blocked, expect not blocked
    const initial = await p.getBlockState(mac);

    // block: disable internet access, expect blocked
    await p.setInternetAccess(mac, false);
    const afterBlock = await p.getBlockState(mac);

    // unblock: re-enable internet access, expect not blocked
    await p.setInternetAccess(mac, true);
    const afterUnblock = await p.getBlockState(mac);

    // drift hook: force block state out-of-band, expect blocked
    p.forceBlockState(mac, true);
    const afterForce = await p.getBlockState(mac);

    // capability: fake now reports setInternetAccess as supported
    const capOk = p.capabilities().setInternetAccess === true;

    return Response.json({
      ok: true,
      initial_unblocked: initial === false,
      block_ok: afterBlock === true,
      unblock_ok: afterUnblock === false,
      force_ok: afterForce === true,
      cap_ok: capOk,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
