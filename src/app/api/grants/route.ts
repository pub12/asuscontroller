import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { listGrants, createGrant } from '@/server/permissions/grantsService';
import { isCapability } from '@/server/permissions/capabilities';

export const GET = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

  const url = new URL(req.url);
  const subject = url.searchParams.get('subject') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;

  const grants = await listGrants(getDb(), { subject, status });
  return ok({ grants });
});

const CreateGrantBody = z.object({
  subject: z.string(),
  capability: z.string(),
  scopeType: z.enum(['global', 'group']),
  scopeId: z.string().nullable(),
});

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateGrantBody.safeParse(raw ?? {});
  if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid request body');

  const { subject, capability, scopeType, scopeId } = parsed.data;

  if (!isCapability(capability)) {
    return fail('VALIDATION_FAILED', `Unknown capability: ${capability}`);
  }

  const resolvedScopeId = scopeType === 'global' ? null : scopeId;

  const grant = await createGrant(getDb(), {
    subject,
    capability,
    scopeType,
    scopeId: resolvedScopeId,
    grantedBy: auth.subject,
  });

  return ok({ grant });
});
