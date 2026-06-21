import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { runBlockAction } from '@/server/devices/blockActions';
import { authorizeCapability } from '@/server/permissions/authorize';
import { getSharedNotifyProvider } from '@/server/notify/NotifyProvider';
import { notifyDeviceBlock } from '@/server/notify/events';

export const POST = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    const { id } = await ctx.params;

    const decision = await authorizeCapability(
      getDb(),
      { subject: auth.subject, isSuperadmin: auth.isSuperadmin },
      'device.unblock',
      { deviceId: id },
    );
    if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

    const provider = await getRouterProvider();
    const outcome = await runBlockAction(
      getDb(), provider,
      { authorized: true, actorLabel: auth.subject ?? 'unknown', actorUserId: auth.subject },
      id, 'unblock',
    );
    if (outcome.ok === false) return fail(outcome.code, outcome.message);
    const r = outcome.result;
    await notifyDeviceBlock(getSharedNotifyProvider(), {
      action: 'unblock',
      deviceLabel: r.device?.friendly_name ?? r.device?.hostname ?? r.device?.mac ?? id,
      actor: auth.subject ?? 'unknown',
    });
    return ok({ device: r.device, blocked: r.blocked, alreadyInState: r.alreadyInState, routerSynced: r.routerSynced });
  },
);
