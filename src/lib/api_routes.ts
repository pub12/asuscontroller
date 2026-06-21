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

export const grantsListRoute = defineRoute({
  method: 'GET',
  path: '/api/grants',
  summary: 'List permission grants (superadmin only)',
  responses: {
    200: {
      description: 'List of grants, optionally filtered by subject or status',
      schema: z.object({ grants: z.array(z.any()) }),
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Superadmin only' },
  },
});

export const grantsCreateRoute = defineRoute({
  method: 'POST',
  path: '/api/grants',
  summary: 'Create a permission grant (superadmin only)',
  responses: {
    200: {
      description: 'Newly created or reactivated grant',
      schema: z.object({ grant: z.any() }),
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Superadmin only' },
    422: { description: 'Invalid request body or unknown capability' },
  },
});

export const grantRevokeRoute = defineRoute({
  method: 'DELETE',
  path: '/api/grants/{id}',
  summary: 'Revoke a permission grant by ID (superadmin only)',
  responses: {
    200: {
      description: 'Revoked grant',
      schema: z.object({ grant: z.any() }),
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Superadmin only' },
    404: { description: 'Grant not found' },
  },
});

export const requestsListRoute = defineRoute({
  method: 'GET',
  path: '/api/requests',
  summary: 'List access requests (superadmin sees all; users see own)',
  responses: {
    200: {
      description: 'List of access requests visible to the caller',
      schema: z.object({ requests: z.array(z.any()) }),
    },
    401: { description: 'Not authenticated' },
  },
});

export const requestsCreateRoute = defineRoute({
  method: 'POST',
  path: '/api/requests',
  summary: 'Submit an access request for a capability',
  responses: {
    200: {
      description: 'Created request, or noop:true if caller is superadmin',
      schema: z.object({ request: z.any().nullable(), noop: z.boolean().optional() }),
    },
    401: { description: 'Not authenticated' },
    422: { description: 'Invalid request body or unknown capability' },
  },
});

export const requestApproveRoute = defineRoute({
  method: 'POST',
  path: '/api/requests/{id}/approve',
  summary: 'Approve a pending access request (superadmin only)',
  responses: {
    200: {
      description: 'Approved request and the resulting grant',
      schema: z.object({ request: z.any(), grant: z.any() }),
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Superadmin only' },
    404: { description: 'Request not found or not pending' },
  },
});

export const requestDeclineRoute = defineRoute({
  method: 'POST',
  path: '/api/requests/{id}/decline',
  summary: 'Decline a pending access request (superadmin only)',
  responses: {
    200: {
      description: 'Declined request',
      schema: z.object({ request: z.any() }),
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Superadmin only' },
    404: { description: 'Request not found' },
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
  grantsListRoute,
  grantsCreateRoute,
  grantRevokeRoute,
  requestsListRoute,
  requestsCreateRoute,
  requestApproveRoute,
  requestDeclineRoute,
];
