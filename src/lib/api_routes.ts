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

export const adminUsersRoute = defineRoute({
  method: 'GET',
  path: '/api/admin/users',
  summary: 'List all users (superadmin only) — safe fields only',
  responses: {
    200: {
      description: 'List of users with safe fields (no password/token columns)',
      schema: z.object({
        users: z.array(
          z.object({
            id: z.string(),
            email_address: z.string(),
            name: z.string().nullable(),
            status: z.string().nullable(),
            created_at: z.string().nullable(),
          }),
        ),
      }),
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Superadmin only' },
  },
});

export const groupsListRoute = defineRoute({
  method: 'GET',
  path: '/api/groups',
  summary: 'List all groups with member counts and block status',
  responses: {
    200: {
      description: 'Groups with aggregated member/block stats',
      schema: z.object({ groups: z.array(z.any()) }),
    },
    401: { description: 'Not authenticated' },
  },
});

export const groupsCreateRoute = defineRoute({
  method: 'POST',
  path: '/api/groups',
  summary: 'Create a new group',
  responses: {
    200: {
      description: 'Created group row',
      schema: z.object({ group: z.any() }),
    },
    401: { description: 'Not authenticated' },
    422: { description: 'Invalid request body' },
  },
});

export const groupGetRoute = defineRoute({
  method: 'GET',
  path: '/api/groups/{id}',
  summary: 'Get a group with its members',
  responses: {
    200: {
      description: 'Group and members array',
      schema: z.object({ group: z.any(), members: z.array(z.any()) }),
    },
    401: { description: 'Not authenticated' },
    404: { description: 'Group not found' },
  },
});

export const groupPatchRoute = defineRoute({
  method: 'PATCH',
  path: '/api/groups/{id}',
  summary: 'Update group metadata',
  responses: {
    200: {
      description: 'Updated group row',
      schema: z.object({ group: z.any() }),
    },
    401: { description: 'Not authenticated' },
    404: { description: 'Group not found' },
    422: { description: 'Invalid request body' },
  },
});

export const groupDeleteRoute = defineRoute({
  method: 'DELETE',
  path: '/api/groups/{id}',
  summary: 'Delete a group and clear member references',
  responses: {
    200: {
      description: 'Deletion confirmed',
      schema: z.object({ deleted: z.literal(true) }),
    },
    401: { description: 'Not authenticated' },
    404: { description: 'Group not found' },
  },
});

export const groupAddMembersRoute = defineRoute({
  method: 'POST',
  path: '/api/groups/{id}/members',
  summary: 'Add devices to a group',
  responses: {
    200: {
      description: 'Updated group and members',
      schema: z.object({ group: z.any(), members: z.array(z.any()) }),
    },
    401: { description: 'Not authenticated' },
    404: { description: 'Group not found' },
    422: { description: 'Invalid request body' },
  },
});

export const groupRemoveMemberRoute = defineRoute({
  method: 'DELETE',
  path: '/api/groups/{id}/members/{deviceId}',
  summary: 'Remove a device from a group',
  responses: {
    200: {
      description: 'Updated group and members after removal',
      schema: z.object({ group: z.any(), members: z.array(z.any()) }),
    },
    401: { description: 'Not authenticated' },
    404: { description: 'Group not found' },
  },
});

export const groupImageUploadRoute = defineRoute({
  method: 'POST',
  path: '/api/groups/image',
  summary: 'Upload a group image (returns image_file_id)',
  responses: {
    200: {
      description: 'Uploaded image file ID',
      schema: z.object({ image_file_id: z.string() }),
    },
    401: { description: 'Not authenticated' },
    422: { description: 'Validation failed (bad type, oversize, no file)' },
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
  adminUsersRoute,
  groupsListRoute,
  groupsCreateRoute,
  groupGetRoute,
  groupPatchRoute,
  groupDeleteRoute,
  groupAddMembersRoute,
  groupRemoveMemberRoute,
  groupImageUploadRoute,
];
