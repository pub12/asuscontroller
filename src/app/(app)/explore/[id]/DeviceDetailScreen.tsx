'use client';

import { useState, useTransition, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Laptop,
  Smartphone,
  Tablet,
  Tv,
  Gamepad2,
  Speaker,
  Watch,
  Router,
  Monitor,
  HardDrive,
  Wifi,
  WifiOff,
  Ban,
  ShieldCheck,
  Clock,
  Activity,
  Globe,
  SquarePen,
  CalendarClock,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  HazoUiDialog,
  successToast,
  errorToast,
} from 'hazo_ui';
import type { DeviceRow } from '@/server/devices/deviceService';
import type { DeviceActivity, ActivityItem } from '@/server/devices/deviceActivity';
import type { DomainInsights } from '@/server/telemetry/deviceDomainInsights';
import { BlockTimerModal } from '@/components/BlockTimerModal';

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------
const ICONS: Record<string, LucideIcon> = {
  laptop: Laptop,
  smartphone: Smartphone,
  tablet: Tablet,
  tv: Tv,
  gamepad: Gamepad2,
  speaker: Speaker,
  watch: Watch,
  router: Router,
  desktop: Monitor,
  generic: HardDrive,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  device: DeviceRow;
  isBlocked: boolean;
  isSuperadmin: boolean;
  activity: DeviceActivity;
  telemetryConfigured: boolean;
  domainsToday: DomainInsights;
  domains7d: DomainInsights;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deviceDisplayName(d: DeviceRow): string {
  return d.friendly_name || d.hostname || d.mac || '—';
}

function formatMinutes(mins: number): string {
  if (mins === 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function timeAgo(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: string | undefined }) {
  const online = status === 'online';
  const Icon = online ? Wifi : WifiOff;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        online ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      <Icon className="h-3 w-3" />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

function BlockedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      <Ban className="h-3 w-3" />
      Blocked
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event name → label/color/icon
// ---------------------------------------------------------------------------
interface EventMeta {
  label: string;
  colorClass: string;
  Icon: LucideIcon;
}

function eventMeta(eventName: string): EventMeta {
  switch (eventName) {
    case 'device_blocked':
      return { label: 'Blocked', colorClass: 'text-red-600', Icon: Ban };
    case 'device_unblocked':
      return { label: 'Unblocked', colorClass: 'text-green-600', Icon: ShieldCheck };
    case 'device_block_reapplied':
      return { label: 'Block re-applied (drift)', colorClass: 'text-amber-600', Icon: Activity };
    default:
      return { label: eventName, colorClass: 'text-gray-600', Icon: Activity };
  }
}

function TimelineItemRow({ item }: { item: ActivityItem }) {
  if (item.kind === 'event') {
    const meta = eventMeta(item.event_name ?? '');
    const { Icon } = meta;
    return (
      <div className="flex items-start gap-3 py-3">
        <span className={`mt-0.5 flex-shrink-0 ${meta.colorClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${meta.colorClass}`}>{meta.label}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {item.actor_label ?? item.actor_kind} &middot; {timeAgo(item.occurred_at)}
          </p>
        </div>
      </div>
    );
  }

  // kind === 'field'
  const hasDiff = item.before_value != null || item.after_value != null;
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex-shrink-0 text-gray-400">
        <SquarePen className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-700">
          {item.field_path ?? '?'} {item.op ?? ''}
        </p>
        {hasDiff && (
          <p className="mt-0.5 text-xs text-gray-500">
            {item.before_value ?? '—'} &rarr; {item.after_value ?? '—'}
          </p>
        )}
        <p className="mt-0.5 text-xs text-gray-400">
          {item.actor_label ?? item.actor_kind} &middot; {timeAgo(item.occurred_at)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeviceDetailScreen
// ---------------------------------------------------------------------------
export function DeviceDetailScreen({
  device,
  isBlocked,
  isSuperadmin,
  activity,
  telemetryConfigured,
  domainsToday,
  domains7d,
}: Props) {
  const router = useRouter();
  const [, setPending] = useTransition();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [domainRange, setDomainRange] = useState<'today' | '7d'>('today');
  const domains = domainRange === 'today' ? domainsToday : domains7d;

  const DeviceIcon = ICONS[device.icon ?? ''] ?? HardDrive;
  const displayName = deviceDisplayName(device);

  // ------------------------------------------------------------------
  // Access toggle
  // ------------------------------------------------------------------
  async function handleToggleBlock() {
    const blocking = !isBlocked;
    const url = `/api/devices/${device.id}/${blocking ? 'block' : 'unblock'}`;
    setToggling(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: blocking ? JSON.stringify({ reason: null }) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({
          title: blocking ? 'Block failed' : 'Unblock failed',
          description: json.error?.message ?? 'Unknown error',
        });
        return;
      }
      successToast({ title: blocking ? 'Device blocked' : 'Device unblocked' });
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({
        title: blocking ? 'Block failed' : 'Unblock failed',
        description: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setToggling(false);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ---- Header ---- */}
      <div>
        <Link
          href="/explore"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Explore
        </Link>

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
            <DeviceIcon className="h-6 w-6 text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-900 truncate">{displayName}</h1>
              <StatusChip status={device.status} />
              {isBlocked && <BlockedBadge />}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {device.mac ?? '—'}
              {device.vendor && <span className="ml-2 text-gray-400">{device.vendor}</span>}
              {device.current_ip && (
                <span className="ml-2 text-gray-400">{device.current_ip}</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ---- Access toggle ---- */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-800">Internet Access</h2>
        {isSuperadmin ? (
          <div className="flex flex-wrap items-center gap-3">
            {isBlocked ? (
              <Button
                onClick={() => { void handleToggleBlock(); }}
                disabled={toggling}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                Unblock
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => setConfirmBlock(true)}
                disabled={toggling}
              >
                <Ban className="mr-1.5 h-4 w-4" />
                Block internet
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setShowTimerModal(true)}
              className="gap-1.5 text-teal-700 border-teal-200 hover:bg-teal-50"
            >
              <CalendarClock className="h-4 w-4" />
              Set timer / Schedule
            </Button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            Read-only — superadmin required to change access.
          </p>
        )}
      </section>

      {/* ---- Time on device ---- */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-800 flex items-center gap-2">
          <Clock className="h-4 w-4 text-gray-400" />
          Time on Device
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Today" value={formatMinutes(activity.presence.todayMinutes)} />
          <StatCard label="Last 7 days" value={formatMinutes(activity.presence.last7Minutes)} />
          <StatCard label="All time" value={formatMinutes(activity.presence.allTimeMinutes)} />
        </div>

        {activity.presence.byDay.length > 0 ? (
          <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {activity.presence.byDay.map((row) => (
              <li key={row.day} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700">{row.day}</span>
                <span className="font-medium text-gray-900">
                  {formatMinutes(row.connected_minutes)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState title="No presence recorded yet" description="Presence data will appear once the device is active." />
          </div>
        )}
      </section>

      {/* ---- Activity timeline ---- */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-800 flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-400" />
          Activity
        </h2>
        {activity.timeline.length > 0 ? (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-4">
            {activity.timeline.map((item, i) => (
              <TimelineItemRow key={i} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState title="No activity yet" description="Block/unblock events and field changes will appear here." />
        )}
      </section>

      {/* ---- Top domains ---- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-400" />
            Top Domains
          </h2>
          {telemetryConfigured && domains.monitoringEnabled && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDomainRange('today')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  domainRange === 'today'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setDomainRange('7d')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  domainRange === '7d'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                7d
              </button>
            </div>
          )}
        </div>

        {!telemetryConfigured ? (
          <EmptyState
            title="Domain insights not configured"
            description="Connect a telemetry provider (NextDNS) to see this device's top domains."
          />
        ) : !domains.monitoringEnabled ? (
          <EmptyState
            title="Monitoring is off for this group"
            description="Domain insights are hidden because this device's group has monitoring disabled. A superadmin can re-enable monitoring in the group's settings."
          />
        ) : domains.topDomains.length === 0 ? (
          <EmptyState
            title="No domain activity yet"
            description="Once telemetry ingest runs, this device's top domains and recent lookups will appear here."
          />
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-400">
              {domains.totalQueries} queries &middot; {domains.topDomains.length} domains
            </p>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-4">
              {domains.topDomains.map((d) => (
                <div key={d.domain} className="flex items-center justify-between py-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{d.domain}</span>
                  <div className="ml-4 flex flex-shrink-0 items-center gap-2">
                    {d.blockedCount > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        {d.blockedCount} blocked
                      </span>
                    )}
                    <span className="text-xs text-gray-500">{d.count} queries</span>
                    <span className="text-xs text-gray-400">{timeAgo(d.lastSeen)}</span>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Recent lookups</h3>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-4">
              {domains.timeline.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{item.domain}</span>
                  <div className="ml-4 flex flex-shrink-0 items-center gap-2">
                    {item.blocked && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        blocked
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{timeAgo(item.ts)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---- Block confirm dialog ---- */}
      {confirmBlock && (
        <HazoUiDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmBlock(false); }}
          title={`Block ${displayName}?`}
          actionButtonText="Block"
          cancelButtonText="Cancel"
          showCancelButton
          onConfirm={() => { setConfirmBlock(false); void handleToggleBlock(); }}
          onCancel={() => setConfirmBlock(false)}
          sizeWidth="420px"
        >
          <div className="p-4 text-sm text-gray-600">
            This cuts internet access for this device at the router. You can unblock it again at any time.
          </div>
        </HazoUiDialog>
      )}

      {/* ---- Timer / Schedule modal ---- */}
      {showTimerModal && (
        <BlockTimerModal
          open={showTimerModal}
          onOpenChange={setShowTimerModal}
          targetType="device"
          targetId={device.id ?? ''}
          targetLabel={displayName}
          isBlocked={isBlocked}
        />
      )}
    </div>
  );
}
