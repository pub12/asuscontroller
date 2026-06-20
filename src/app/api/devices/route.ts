import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { listDevicesAndGroups } from '@/server/devices/deviceService';

export const GET = withRequestContext(async () => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const { devices, groups } = await listDevicesAndGroups();
  return ok({ devices, groups });
});
