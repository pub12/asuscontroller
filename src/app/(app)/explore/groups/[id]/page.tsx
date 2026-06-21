import { notFound } from 'next/navigation';
import { resolveServerAuth } from '@/server/auth';
import { getGroup } from '@/server/groups/groupService';
import { listDevicesAndGroups } from '@/server/devices/deviceService';
import { getDb } from '@/server/db';
import { GroupDetailScreen } from './GroupDetailScreen';

export const dynamic = 'force-dynamic';

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [auth, result, { devices: allDevices }] = await Promise.all([
    resolveServerAuth(),
    getGroup(getDb(), id),
    listDevicesAndGroups(),
  ]);

  // Defense-in-depth: middleware already redirects unauthenticated requests for
  // /explore/:path*, but never render group/member data without an auth check.
  if (!auth.authenticated) {
    notFound();
  }

  if (!result) {
    notFound();
  }

  return (
    <main className="min-h-screen p-6">
      <GroupDetailScreen
        group={result.group}
        members={result.members}
        allDevices={allDevices}
        isSuperadmin={auth.isSuperadmin}
      />
    </main>
  );
}
