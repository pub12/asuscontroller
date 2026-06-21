import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { removeMember, getGroup } from '@/server/groups/groupService';

export const DELETE = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

    const { id, deviceId } = await ctx.params;

    const db = getDb();
    const existing = await getGroup(db, id);
    if (!existing) return fail('NOT_FOUND', 'Group not found');

    await removeMember(db, id, deviceId);

    const result = await getGroup(db, id);
    if (!result) return fail('NOT_FOUND', 'Group not found');

    return ok({ group: result.group, members: result.members });
  },
);
