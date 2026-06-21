import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { approveRequest } from '@/server/permissions/grantsService';

export const POST = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

    const { id } = await ctx.params;

    const result = await approveRequest(getDb(), id, auth.subject);
    if (!result) return fail('NOT_FOUND', 'Request not found or not pending');

    return ok({ request: result.request, grant: result.grant });
  },
);
