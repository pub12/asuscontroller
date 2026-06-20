import { defineRoute } from 'hazo_api';
import { z } from 'zod';

export const healthRoute = defineRoute({
  method: 'GET',
  path: '/api/health',
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'Server is alive',
      schema: z.object({ status: z.literal('ok'), server_time: z.string() }),
    },
  },
});

export const meRoute = defineRoute({
  method: 'GET',
  path: '/api/me',
  summary: 'Current subject + permissions',
  responses: {
    200: {
      description: 'Authenticated subject with permissions',
      schema: z.object({
        subject: z.string(),
        permissions: z.array(z.string()),
        is_superadmin: z.boolean(),
      }),
    },
    401: {
      description: 'Not authenticated',
    },
  },
});

export const rateLimitedDemoRoute = defineRoute({
  method: 'GET',
  path: '/api/v1/demo/rate_limited',
  summary: 'Rate-limited demo (5 req / 10 s)',
  responses: {
    200: {
      description: 'Allowed — returns hit timestamp',
      schema: z.object({ hit_at: z.string() }),
    },
    429: {
      description: 'Rate limit exceeded',
    },
  },
});

export const ALL_ROUTES = [healthRoute, meRoute, rateLimitedDemoRoute];
