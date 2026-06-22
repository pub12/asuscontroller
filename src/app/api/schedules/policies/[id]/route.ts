import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { setPolicyEnabled, deletePolicy, clearOverrideForTarget } from '@/server/schedules/policyService';

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };

async function targetOf(
  adapter: RawAdapter,
  id: string,
): Promise<{ target_type: 'device' | 'group'; target_id: string } | null> {
  const rows = await adapter.rawQuery(
    `SELECT target_type, target_id FROM app_schedule_policies WHERE id = ?`,
    { params: [id] },
  );
  return rows[0] ?? null;
}

const PatchBody = z.object({ enabled: z.boolean() });

export const PATCH = withRequestContext(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const { id } = await ctx.params;
  let json: unknown;
  try { json = await req.json(); } catch { return fail('VALIDATION_FAILED', 'Invalid JSON body'); }
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return fail('VALIDATION_FAILED', 'enabled (boolean) required');

  const adapter = getDb();
  const t = await targetOf(adapter as unknown as RawAdapter, id);
  if (!t) return fail('NOT_FOUND', 'Policy not found');
  await setPolicyEnabled(adapter, id, parsed.data.enabled);
  if (!parsed.data.enabled) await clearOverrideForTarget(adapter, t.target_type, t.target_id);
  return ok({ id, enabled: parsed.data.enabled });
});

export const DELETE = withRequestContext(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const { id } = await ctx.params;
  const adapter = getDb();
  const t = await targetOf(adapter as unknown as RawAdapter, id);
  if (!t) return fail('NOT_FOUND', 'Policy not found');
  await deletePolicy(adapter, id);
  await clearOverrideForTarget(adapter, t.target_type, t.target_id);
  return ok({ id, deleted: true });
});
