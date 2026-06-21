import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { runBlockAction } from '@/server/devices/blockActions';

export const POST = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    const { id } = await ctx.params;

    const provider = await getRouterProvider();
    const outcome = await runBlockAction(
      getDb(), provider,
      { isSuperadmin: auth.isSuperadmin, actorLabel: auth.subject ?? 'unknown' },
      id, 'unblock',
    );
    if (outcome.ok === false) return fail(outcome.code, outcome.message);
    const r = outcome.result;
    return ok({ device: r.device, blocked: r.blocked, alreadyInState: r.alreadyInState, routerSynced: r.routerSynced });
  },
);
