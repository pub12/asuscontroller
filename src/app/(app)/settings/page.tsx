import { resolveServerAuth } from '@/server/auth';
import { getRouterProviderMode, getSyncIntervalSec } from '@/lib/env';
import { listDevicesAndGroups } from '@/server/devices/deviceService';
import { SyncPanel } from './SyncPanel';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { isSuperadmin } = await resolveServerAuth();

  if (!isSuperadmin) {
    return (
      <main className="flex min-h-screen bg-background flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-4xl font-bold text-red-600">403</span>
        <h1 className="text-xl font-semibold text-foreground">Superadmin only</h1>
        <p className="text-sm text-muted-foreground">
          You do not have permission to view this page.
        </p>
      </main>
    );
  }

  const providerMode = getRouterProviderMode();
  const intervalSec = getSyncIntervalSec();

  let deviceCount = 0;
  let blockedCount = 0;
  try {
    const { devices } = await listDevicesAndGroups();
    deviceCount = devices.length;
    blockedCount = devices.filter((d) => Number(d.is_blocked) === 1).length;
  } catch {
    // best-effort — leave counts at 0 if the DB is unavailable
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">Settings</h1>

      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-base font-medium text-foreground">Router</h2>
          <dl className="space-y-1 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <dt className="font-medium text-foreground">Host:</dt>
              <dd>configured via .env / staged spike</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-foreground">User:</dt>
              <dd>configured via .env / staged spike</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-base font-medium text-foreground">Telemetry</h2>
          <p className="text-sm text-muted-foreground">Provider undecided — NextDNS preferred.</p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-base font-medium text-foreground">Polling</h2>
          <p className="text-sm text-muted-foreground">Polling interval — placeholder from app config.</p>
        </section>

        <SyncPanel
          providerMode={providerMode}
          intervalSec={intervalSec}
          deviceCount={deviceCount}
          blockedCount={blockedCount}
        />
      </div>
    </main>
  );
}
