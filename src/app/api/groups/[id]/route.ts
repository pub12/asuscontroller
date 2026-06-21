import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getGroup, updateGroup, deleteGroup } from '@/server/groups/groupService';

export const GET = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;
    const result = await getGroup(getDb(), id);
    if (!result) return fail('NOT_FOUND', 'Group not found');

    return ok({ group: result.group, members: result.members });
  },
);

const PatchGroupBody = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['person', 'generic']).optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_file_id: z.string().nullable().optional(),
});

export const PATCH = withRequestContext(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return fail('VALIDATION_FAILED', 'Invalid JSON body');
    }

    const parsed = PatchGroupBody.safeParse(json);
    if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid request body');

    const { name, type, color, description, image_file_id } = parsed.data;
    const patch: Parameters<typeof updateGroup>[2] = {};
    if (name !== undefined) patch.name = name;
    if (type !== undefined) patch.type = type;
    if (color !== undefined) patch.color = color;
    if (description !== undefined) patch.description = description;
    if (image_file_id !== undefined) patch.imageFileId = image_file_id;

    const group = await updateGroup(getDb(), id, patch);
    if (!group) return fail('NOT_FOUND', 'Group not found');

    return ok({ group });
  },
);

export const DELETE = withRequestContext(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await resolveServerAuth();
    if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

    const { id } = await ctx.params;
    const deleted = await deleteGroup(getDb(), id);
    if (!deleted) return fail('NOT_FOUND', 'Group not found');

    return ok({ deleted: true });
  },
);
