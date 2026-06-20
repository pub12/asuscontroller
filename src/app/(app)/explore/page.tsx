import { resolveServerAuth } from '@/server/auth';
import { listDevicesAndGroups } from '@/server/devices/deviceService';
import { DevicesScreen } from './DevicesScreen';

export const dynamic = 'force-dynamic'; // always fresh device data

export default async function ExplorePage() {
  await resolveServerAuth();
  const { devices, groups } = await listDevicesAndGroups();
  return (
    <main className="min-h-screen p-6">
      <DevicesScreen devices={devices} groups={groups} />
    </main>
  );
}
