import { notFound } from 'next/navigation';
import { resolveServerAuth } from '@/server/auth';
import { getDevice } from '@/server/devices/deviceService';
import { getBlockRow } from '@/server/devices/blockService';
import { getDeviceActivity } from '@/server/devices/deviceActivity';
import { getDb } from '@/server/db';
import { NextDnsProvider } from '@/server/telemetry/NextDnsProvider';
import { DeviceDetailScreen } from './DeviceDetailScreen';

export const dynamic = 'force-dynamic';

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [auth, device] = await Promise.all([
    resolveServerAuth(),
    getDevice(id),
  ]);

  if (!device) {
    notFound();
  }

  const db = getDb();

  const [blockRow, activity] = await Promise.all([
    getBlockRow(db, id),
    getDeviceActivity(db, id, new Date().toISOString().slice(0, 10)),
  ]);

  const isBlocked = Number((blockRow as Record<string, unknown> | null)?.is_blocked) === 1;

  const telemetryProvider = new NextDnsProvider();
  const telemetryConfigured = await telemetryProvider.isConfigured();

  return (
    <main className="min-h-screen p-6">
      <DeviceDetailScreen
        device={device}
        isBlocked={isBlocked}
        isSuperadmin={auth.isSuperadmin}
        activity={activity}
        telemetryConfigured={telemetryConfigured}
      />
    </main>
  );
}
