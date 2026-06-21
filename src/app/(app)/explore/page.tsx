import { headers } from 'next/headers';
import { resolveServerAuth } from '@/server/auth';
import { listDevicesAndGroups } from '@/server/devices/deviceService';
import { listGroups } from '@/server/groups/groupService';
import { getDb } from '@/server/db';
import { DevicesScreen } from './DevicesScreen';

export const dynamic = 'force-dynamic'; // always fresh device data

/** Best-effort client IP of the request (the device viewing this page). */
async function requestClientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() ?? null;
}

export default async function ExplorePage() {
  const auth = await resolveServerAuth();
  const { devices, groups } = await listDevicesAndGroups();
  const groupSummaries = await listGroups(getDb());

  // Tag the device whose current_ip matches this request, so the UI can show a
  // "This device" label. Best-effort: on localhost the IP is ::1/127.0.0.1 and
  // won't match a LAN address — the label simply doesn't show in that case.
  const clientIp = await requestClientIp();
  const currentDeviceId =
    clientIp != null
      ? (devices.find((d) => d.current_ip && d.current_ip === clientIp)?.id ?? null)
      : null;

  return (
    <main className="min-h-screen p-6">
      <DevicesScreen
        devices={devices}
        groups={groups}
        groupSummaries={groupSummaries}
        isSuperadmin={auth.isSuperadmin}
        currentDeviceId={currentDeviceId}
      />
    </main>
  );
}
