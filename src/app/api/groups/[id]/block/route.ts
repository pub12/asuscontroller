import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { runGroupBlockAction } from '@/server/groups/groupBlockActions';
import { authorizeCapability } from '@/server/permissions/authorize';

export const POST = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    const { id } = await ctx.params;

    const decision = await authorizeCapability(
      getDb(),
      { subject: auth.subject, isSuperadmin: auth.isSuperadmin },
      'group.block',
      { scopeType: 'group', scopeId: id },
    );
    if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

    const provider = await getRouterProvider();
    const outcome = await runGroupBlockAction(
      getDb(), provider,
      { authorized: true, actorLabel: auth.subject ?? 'unknown', actorUserId: auth.subject },
      id, 'block',
    );
    if (outcome.ok === false) return fail(outcome.code, outcome.message);
    return ok(outcome.summary);
  },
);
