import { resolveServerAuth } from '@/server/auth';
import { listDevicesAndGroups } from '@/server/devices/deviceService';
import { CreateGroupScreen } from './CreateGroupScreen';

export const dynamic = 'force-dynamic';

export default async function CreateGroupPage() {
  const auth = await resolveServerAuth();

  if (!auth.isSuperadmin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-4xl font-bold text-red-600">403</span>
        <h1 className="text-xl font-semibold text-gray-900">Superadmin only</h1>
        <p className="text-sm text-gray-500">
          You do not have permission to create groups.
        </p>
      </main>
    );
  }

  const { devices } = await listDevicesAndGroups();

  return (
    <main className="min-h-screen p-6">
      <CreateGroupScreen devices={devices} />
    </main>
  );
}
