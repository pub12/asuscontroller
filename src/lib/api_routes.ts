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

export const devicesRoute = defineRoute({
  method: 'GET',
  path: '/api/devices',
  summary: 'List all devices and groups',
  responses: {
    200: {
      description: 'Devices and groups',
      schema: z.object({ devices: z.array(z.any()), groups: z.array(z.any()) }),
    },
    401: {
      description: 'Not authenticated',
    },
  },
});

export const devicePatchRoute = defineRoute({
  method: 'PATCH',
  path: '/api/devices/{id}',
  summary: 'Update user-owned fields on a device',
  responses: {
    200: {
      description: 'Updated device',
      schema: z.object({ device: z.any() }),
    },
    422: {
      description: 'Invalid request body or unknown group',
    },
    401: {
      description: 'Not authenticated',
    },
    404: {
      description: 'Device not found',
    },
  },
});

export const deviceAcknowledgeRoute = defineRoute({
  method: 'POST',
  path: '/api/devices/{id}/acknowledge',
  summary: 'Acknowledge a new device (clears is_new flag)',
  responses: {
    200: {
      description: 'Acknowledged device',
      schema: z.object({ device: z.any() }),
    },
    401: {
      description: 'Not authenticated',
    },
    404: {
      description: 'Device not found',
    },
  },
});

export const syncRunRoute = defineRoute({
  method: 'POST',
  path: '/api/sync/run',
  summary: 'Trigger a device sync immediately (superadmin only)',
  responses: {
    200: {
      description: 'Sync completed — returns summary',
      schema: z.object({ summary: z.any() }),
    },
    401: {
      description: 'Not authenticated',
    },
    403: {
      description: 'Superadmin only',
    },
  },
});

export const syncStatusRoute = defineRoute({
  method: 'GET',
  path: '/api/sync/status',
  summary: 'Status of the most recent netwarden.sync job',
  responses: {
    200: {
      description: 'Last sync job info (nulls if never run)',
      schema: z.object({
        last_run_at: z.string().nullable(),
        status: z.string().nullable(),
        summary: z.any().nullable(),
      }),
    },
    401: {
      description: 'Not authenticated',
    },
  },
});

export const ALL_ROUTES = [
  healthRoute,
  meRoute,
  rateLimitedDemoRoute,
  devicesRoute,
  devicePatchRoute,
  deviceAcknowledgeRoute,
  syncRunRoute,
  syncStatusRoute,
];
