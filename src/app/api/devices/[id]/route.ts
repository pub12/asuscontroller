import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { updateDeviceUserFields } from '@/server/devices/deviceService';

const Body = z.object({
  friendly_name: z.string().max(200).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  primary_group_id: z.string().nullable().optional(),
});

export const PATCH = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return fail('VALIDATION_FAILED', 'Invalid JSON body');
    }

    const parsed = Body.safeParse(json);
    if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid fields');

    try {
      const device = await updateDeviceUserFields(id, parsed.data);
      if (!device) return fail('NOT_FOUND', 'Device not found');
      return ok({ device });
    } catch (e) {
      if (e instanceof Error && e.message === 'BAD_GROUP') {
        return fail('VALIDATION_FAILED', 'Unknown primary_group_id');
      }
      throw e;
    }
  }
);
