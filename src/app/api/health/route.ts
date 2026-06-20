import { ok, withRequestContext } from 'hazo_api';

export const GET = withRequestContext(async () => {
  return ok({ status: 'ok' as const, server_time: new Date().toISOString() });
});
