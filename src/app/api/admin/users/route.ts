import { ok, fail, withRequestContext } from 'hazo_api';
import { createCrudService } from 'hazo_connect/server';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';

interface UserRow extends Record<string, unknown> {
  id: string;
  email_address: string;
  name: string | null;
  status: string | null;
  created_at: string | null;
}

export const GET = withRequestContext(async () => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  if (!auth.isSuperadmin) return fail('FORBIDDEN', 'Superadmin only');

  const svc = createCrudService<UserRow>(getDb(), 'hazo_users');
  const allRows = await svc.list();

  // Return ONLY safe fields — never expose password_hash, mfa_secret, pin_hash, or tokens
  const users = allRows.map((row) => ({
    id: row.id,
    email_address: row.email_address,
    name: row.name ?? null,
    status: row.status ?? null,
    created_at: row.created_at ?? null,
  }));

  return ok({ users });
});
