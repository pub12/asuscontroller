import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { listGroups, createGroup } from '@/server/groups/groupService';

export const GET = withRequestContext(async () => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const groups = await listGroups(getDb());
  return ok({ groups });
});

const CreateGroupBody = z.object({
  name: z.string().min(1),
  type: z.enum(['person', 'generic']).optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_file_id: z.string().nullable().optional(),
  member_ids: z.array(z.string()).optional(),
});

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail('VALIDATION_FAILED', 'Invalid JSON body');
  }

  const parsed = CreateGroupBody.safeParse(json);
  if (!parsed.success) return fail('VALIDATION_FAILED', 'Invalid request body');

  const { name, type, color, description, image_file_id, member_ids } = parsed.data;
  const group = await createGroup(getDb(), {
    name,
    type,
    color,
    description,
    imageFileId: image_file_id,
    memberIds: member_ids,
    createdBy: auth.subject,
  });

  return ok({ group });
});
