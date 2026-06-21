import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { declineRequest } from '@/server/permissions/grantsService';

export const POST = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

    const { id } = await ctx.params;

    const request = await declineRequest(getDb(), id, auth.subject);
    if (!request) return fail('NOT_FOUND', 'Request not found');

    return ok({ request });
  },
);
