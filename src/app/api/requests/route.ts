import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { listRequests, createRequest, filterVisibleRequests } from '@/server/permissions/grantsService';
import { isCapability } from '@/server/permissions/capabilities';

export const GET = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;

  const viewer = { subject: auth.subject, isSuperadmin: auth.isSuperadmin };

  // Superadmin: fetch all (with optional status filter); non-superadmin: only their own
  const rows = auth.isSuperadmin
    ? await listRequests(getDb(), { status })
    : await listRequests(getDb(), { subject: auth.subject ?? undefined, status });

  const requests = filterVisibleRequests(viewer, rows);
  return ok({ requests });
});

const CreateRequestBody = z.object({
  capability: z.string(),
  scopeType: z.enum(['global', 'group']),
  scopeId: z.string().nullable(),
  note: z.string().nullable().optional(),
});

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateRequestBody.safeParse(raw ?? {});
  if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid request body');

  const { capability, scopeType, scopeId, note } = parsed.data;

  if (!isCapability(capability)) {
    return fail('VALIDATION_FAILED', `Unknown capability: ${capability}`);
  }

  // Spec A6: superadmin self-request is a no-op — they're already authorized
  if (auth.isSuperadmin) {
    return ok({ request: null, noop: true });
  }

  const request = await createRequest(getDb(), {
    subject: auth.subject!,
    capability,
    scopeType,
    scopeId,
    note: note ?? null,
  });

  return ok({ request });
});
