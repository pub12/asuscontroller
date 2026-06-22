import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { authorizeCapability } from '@/server/permissions/authorize';
import { getPolicy, upsertPolicy, applyPolicyNow } from '@/server/schedules/policyService';
import { policyState, nextTransition } from '@/server/sync/runDeviceSync';

const RuleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time_min: z.number().int().min(0).max(1439),
  action: z.enum(['block', 'unblock']),
});
const Body = z.object({
  targetType: z.enum(['device', 'group']),
  targetId: z.string().min(1),
  enabled: z.boolean().default(true),
  label: z.string().optional(),
  rules: z.array(RuleSchema).max(200),
});

export const GET = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const url = new URL(req.url);
  const targetType = url.searchParams.get('targetType') as 'device' | 'group' | null;
  const targetId = url.searchParams.get('targetId');
  if (!targetType || !targetId) return fail('VALIDATION_FAILED', 'targetType and targetId required');

  const adapter = getDb();
  const policy = await getPolicy(adapter, targetType, targetId);
  const now = Date.now();
  const currentState = policy && policy.enabled ? policyState(policy.rules, now, policy.tz) : null;
  const nt = policy && policy.enabled ? nextTransition(policy.rules, now, policy.tz) : null;
  return ok({ policy, currentState, nextTransitionISO: nt == null ? null : new Date(nt).toISOString() });
});

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  let json: unknown;
  try { json = await req.json(); } catch { return fail('VALIDATION_FAILED', 'Invalid JSON body'); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; '));
  const { targetType, targetId, enabled, label, rules } = parsed.data;

  const adapter = getDb();
  const target = targetType === 'device' ? { deviceId: targetId } : { scopeType: 'group' as const, scopeId: targetId };
  const decision = await authorizeCapability(adapter, { subject: auth.subject, isSuperadmin: auth.isSuperadmin }, 'schedule.create', target);
  if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

  const policy = await upsertPolicy(adapter, { targetType, targetId, enabled, label: label ?? null, rules, actor: { userId: auth.subject } });
  // Apply the policy's current desired state immediately (best-effort).
  try {
    const provider = await getRouterProvider();
    if (enabled) await applyPolicyNow(adapter, provider, targetType, targetId, { userId: auth.subject });
  } catch { /* worker reconcile will converge on next poll */ }

  return ok({ policy });
});
