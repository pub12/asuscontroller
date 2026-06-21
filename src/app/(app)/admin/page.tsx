import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { listGrants, listRequests } from '@/server/permissions/grantsService';
import { createCrudService } from 'hazo_connect/server';
import { AdminScreen } from './AdminScreen';

export const dynamic = 'force-dynamic';

interface UserRow extends Record<string, unknown> {
  id: string;
  email_address: string;
  name: string | null;
  status: string | null;
  created_at: string | null;
}

export interface SafeUserRow {
  id: string;
  email_address: string;
  name: string | null;
  status: string | null;
  created_at: string | null;
}

export default async function AdminPage() {
  const { isSuperadmin } = await resolveServerAuth();

  if (!isSuperadmin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-4xl font-bold text-red-600">403</span>
        <h1 className="text-xl font-semibold text-gray-900">Superadmin only</h1>
        <p className="text-sm text-gray-500">
          You do not have permission to view this page.
        </p>
      </main>
    );
  }

  let grants: Awaited<ReturnType<typeof listGrants>> = [];
  let requests: Awaited<ReturnType<typeof listRequests>> = [];
  let users: SafeUserRow[] = [];

  try {
    const db = getDb();
    [grants, requests] = await Promise.all([listGrants(db), listRequests(db)]);

    const svc = createCrudService<UserRow>(db, 'hazo_users');
    const allRows = await svc.list();
    users = allRows.map((row) => ({
      id: row.id,
      email_address: row.email_address,
      name: row.name ?? null,
      status: row.status ?? null,
      created_at: row.created_at ?? null,
    }));
  } catch {
    // best-effort — render with empty data if the DB is unavailable
  }

  return (
    <main className="min-h-screen p-6">
      <AdminScreen grants={grants} requests={requests} users={users} />
    </main>
  );
}
