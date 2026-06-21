import { notFound } from 'next/navigation';
import { resolveServerAuth } from '@/server/auth';
import { getDevice } from '@/server/devices/deviceService';
import { getBlockRow } from '@/server/devices/blockService';
import { getDeviceActivity } from '@/server/devices/deviceActivity';
import { getDb } from '@/server/db';
import { getTelemetryProvider } from '@/server/telemetry';
import { getDeviceDomainInsights } from '@/server/telemetry/deviceDomainInsights';
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
  const todayIso = new Date().toISOString().slice(0, 10);

  const [blockRow, activity] = await Promise.all([
    getBlockRow(db, id),
    getDeviceActivity(db, id, todayIso),
  ]);

  const isBlocked = Number((blockRow as Record<string, unknown> | null)?.is_blocked) === 1;

  const provider = await getTelemetryProvider();
  const telemetryConfigured = await provider.isConfigured();
  const [domainsToday, domains7d] = await Promise.all([
    getDeviceDomainInsights(db, id, todayIso, 'today'),
    getDeviceDomainInsights(db, id, todayIso, '7d'),
  ]);

  return (
    <main className="min-h-screen p-6">
      <DeviceDetailScreen
        device={device}
        isBlocked={isBlocked}
        isSuperadmin={auth.isSuperadmin}
        activity={activity}
        telemetryConfigured={telemetryConfigured}
        domainsToday={domainsToday}
        domains7d={domains7d}
      />
    </main>
  );
}
