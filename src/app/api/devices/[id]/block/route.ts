import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { runBlockAction } from '@/server/devices/blockActions';
import { authorizeCapability } from '@/server/permissions/authorize';
import { getSharedNotifyProvider } from '@/server/notify/NotifyProvider';
import { notifyDeviceBlock } from '@/server/notify/events';

const Body = z.object({ reason: z.string().max(2000).nullable().optional() });

export const POST = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
    const { id } = await ctx.params;

    let reason: string | undefined;
    const raw = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(raw ?? {});
    if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid fields');
    reason = parsed.data.reason ?? undefined;

    const decision = await authorizeCapability(
      getDb(),
      { subject: auth.subject, isSuperadmin: auth.isSuperadmin },
      'device.block',
      { deviceId: id },
    );
    if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

    const provider = await getRouterProvider();
    const outcome = await runBlockAction(
      getDb(), provider,
      { authorized: true, actorLabel: auth.subject ?? 'unknown', actorUserId: auth.subject },
      id, 'block', reason,
    );
    if (outcome.ok === false) return fail(outcome.code, outcome.message);
    const r = outcome.result;
    await notifyDeviceBlock(getSharedNotifyProvider(), {
      action: 'block',
      deviceLabel: r.device?.friendly_name ?? r.device?.hostname ?? r.device?.mac ?? id,
      actor: auth.subject ?? 'unknown',
    });
    return ok({ device: r.device, blocked: r.blocked, alreadyInState: r.alreadyInState, routerSynced: r.routerSynced });
  },
);
