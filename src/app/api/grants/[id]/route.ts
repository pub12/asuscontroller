import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { revokeGrant } from '@/server/permissions/grantsService';

export const DELETE = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

    const { id } = await ctx.params;

    const grant = await revokeGrant(getDb(), id, auth.subject);
    if (!grant) return fail('NOT_FOUND', 'Grant not found');

    return ok({ grant });
  },
);
