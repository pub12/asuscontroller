import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { acknowledgeDevice } from '@/server/devices/deviceService';

export const POST = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;

    const device = await acknowledgeDevice(id);
    if (!device) return fail('NOT_FOUND', 'Device not found');
    return ok({ device });
  }
);
