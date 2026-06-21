import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { addMembers, getGroup } from '@/server/groups/groupService';

const AddMembersBody = z.object({
  device_ids: z.array(z.string()).min(1),
});

export const POST = withRequestContext(
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

    const parsed = AddMembersBody.safeParse(json);
    if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid request body');

    const db = getDb();
    await addMembers(db, id, parsed.data.device_ids, auth.subject);

    const result = await getGroup(db, id);
    if (!result) return fail('NOT_FOUND', 'Group not found');

    return ok({ group: result.group, members: result.members });
  },
);
