import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';

export const GET = withRequestContext(async () => {
  const { authenticated, subject, permissions, isSuperadmin } = await resolveServerAuth();

  if (!authenticated) {
    return fail('UNAUTHORIZED', 'Not authenticated');
  }

  return ok({ subject, permissions, is_superadmin: isSuperadmin });
});
