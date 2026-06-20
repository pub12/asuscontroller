import { ok, withRequestContext, withRateLimit } from 'hazo_api';
import { rateLimitService } from '@/server/api_services';

export const GET = withRequestContext(
  withRateLimit(
    {
      service: rateLimitService,
      bucket_key: (req: Request) =>
        `ip:${req.headers.get('x-forwarded-for') ?? 'local'}`,
      limit: 5,
      window_sec: 10,
    },
    async () => ok({ hit_at: new Date().toISOString() }),
  ),
);
