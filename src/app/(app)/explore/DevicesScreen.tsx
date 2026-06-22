'use client';

import { useState, useEffect, useCallback, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
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
  Pencil,
  Ban,
  ShieldCheck,
  RefreshCw,
  MapPin,
  Plus,
  Clock,
  X,
} from 'lucide-react';
import {
  HazoUiTable,
  type TableColumn,
  EmptyState,
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  HazoUiDialog,
  successToast,
  errorToast,
} from 'hazo_ui';
import type { DeviceRow, GroupRow } from '@/server/devices/deviceService';
import type { GroupSummary } from '@/server/groups/groupService';

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

const ICON_KEYS = Object.keys(ICONS) as (keyof typeof ICONS)[];

// Radix Select forbids an empty-string SelectItem value — use a sentinel for "no group".
const NONE_GROUP = '__none__';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Props {
  devices: DeviceRow[];
  groups: GroupRow[];
  groupSummaries: GroupSummary[];
  isSuperadmin: boolean;
  /** id of the device matching the viewer's IP, if any — gets a "This device" tag. */
  currentDeviceId?: string | null;
}

interface RequestAccessState {
  groupId: string;
  capability: string;
}

type Tab = 'devices' | 'groups';

// Row shape passed to the table: DeviceRow plus a derived `displayName` so the
// table's search/sort (which read row[key]) operate on the same name shown in
// the Name column — including the hostname/mac fallback.
type DeviceTableRow = DeviceRow & { displayName: string };

interface EditState {
  device: DeviceRow;
  friendly_name: string;
  icon: string;
  notes: string;
  primary_group_id: string; // '' means null/none
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deviceDisplayName(d: DeviceRow): string {
  return d.friendly_name || d.hostname || d.mac || '—';
}

function groupById(groups: GroupRow[], id: string | null | undefined): GroupRow | undefined {
  if (!id) return undefined;
  return groups.find((g) => g.id === id);
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------
function StatusChip({ status }: { status: string | undefined }) {
  const online = status === 'online';
  const Icon = online ? Wifi : WifiOff;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        online ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' : 'bg-muted text-muted-foreground'
      }`}
    >
      <Icon className="h-3 w-3" />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Blocked badge
// ---------------------------------------------------------------------------
function BlockedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-400">
      <Ban className="h-3 w-3" />
      Blocked
    </span>
  );
}

// ---------------------------------------------------------------------------
// "This device" badge
// ---------------------------------------------------------------------------
function ThisDeviceBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
      <MapPin className="h-3 w-3" />
      This device
    </span>
  );
}

// ---------------------------------------------------------------------------
// Group badge
// ---------------------------------------------------------------------------
function GroupBadge({ group }: { group: GroupRow | undefined }) {
  if (!group) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground">
      {group.color && (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: group.color }}
        />
      )}
      {group.name ?? ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status filter chip (the device-counter labels double as filter buttons)
// ---------------------------------------------------------------------------
function FilterChip({
  active,
  onClick,
  colorClass,
  activeClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  colorClass: string;
  activeClass: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium transition-colors ${colorClass} ${
        active ? activeClass : 'hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Quick timer — "block for / unblock for a period"
// ---------------------------------------------------------------------------

/** An active one-shot schedule attached to a device, for the row countdown badge. */
interface ActiveTimer {
  id: string;
  action: 'block' | 'unblock';
  run_at: string;
}

// Duration quick-picks (minutes) for the row timer.
const QUICK_DURATIONS = [
  { label: '10m', min: 10 },
  { label: '30m', min: 30 },
  { label: '1h', min: 60 },
  { label: '2h', min: 120 },
] as const;

function durationLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Time remaining until an ISO instant, as a compact label. */
function formatLeft(runAtISO: string, nowMs: number): string {
  const ms = new Date(runAtISO).getTime() - nowMs;
  if (ms <= 0) return 'now';
  const totalMin = Math.max(1, Math.round(ms / 60000));
  return durationLabel(totalMin);
}

// ---------------------------------------------------------------------------
// Active-timer badge (countdown + cancel) shown on a device row
// ---------------------------------------------------------------------------
function TimerBadge({
  timer,
  nowMs,
  onCancel,
}: {
  timer: ActiveTimer;
  nowMs: number;
  onCancel: () => void;
}) {
  // action is what happens WHEN the timer fires.
  const verb = timer.action === 'block' ? 'blocks' : 'unblocks';
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
      <Clock className="h-3 w-3" />
      {verb} in {formatLeft(timer.run_at, nowMs)}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        className="-mr-0.5 ml-0.5 rounded-full p-0.5 hover:bg-amber-200"
        aria-label="Cancel timer"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Quick timer dialog — direction depends on the device's current block state
// ---------------------------------------------------------------------------
function QuickTimerDialog({
  device,
  onClose,
  onCreated,
}: {
  device: DeviceRow;
  onClose: () => void;
  onCreated: () => void;
}) {
  // NOTE: this dialog only schedules the auto-reversal (unblock/re-block at runAt);
  // the background worker (scripts/worker.mjs) must be running for it to fire.
  const blocked = !!device.is_blocked;
  const name = deviceDisplayName(device);
  const [preset, setPreset] = useState<number | 'custom'>(30);
  const [customMin, setCustomMin] = useState('45');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const mins = preset === 'custom' ? parseInt(customMin, 10) : preset;
    if (!mins || mins <= 0) {
      errorToast({ title: 'Invalid duration', description: 'Enter a positive number of minutes.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: blocked ? 'unblock_timer' : 'timer',
          targetType: 'device',
          targetId: device.id,
          durationMin: mins,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Timer failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({
        title: blocked ? `Unblocked for ${durationLabel(mins)}` : `Blocked for ${durationLabel(mins)}`,
        description: blocked
          ? `Auto re-blocks in ${durationLabel(mins)}`
          : `Auto-unblocks in ${durationLabel(mins)}`,
      });
      onCreated();
      onClose();
    } catch (e) {
      errorToast({ title: 'Timer failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <HazoUiDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={blocked ? `Unblock ${name} for…` : `Block ${name} for…`}
      actionButtonText={blocked ? 'Unblock' : 'Block'}
      actionButtonLoading={submitting}
      cancelButtonText="Cancel"
      showCancelButton
      onConfirm={() => { void submit(); }}
      onCancel={onClose}
      sizeWidth="420px"
    >
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          {blocked
            ? 'Unblocks now and automatically re-blocks after the selected time.'
            : 'Blocks now and automatically unblocks after the selected time.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_DURATIONS.map(({ label, min }) => {
            const active = preset === min;
            return (
              <button
                key={min}
                type="button"
                onClick={() => setPreset(min)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary hover:text-primary'
                }`}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPreset('custom')}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              preset === 'custom'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:border-primary hover:text-primary'
            }`}
          >
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
        )}
      </div>
    </HazoUiDialog>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------
function EditDialog({
  editState,
  groups,
  onClose,
  onSaved,
}: {
  editState: EditState;
  groups: GroupRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [friendlyName, setFriendlyName] = useState(editState.friendly_name);
  const [icon, setIcon] = useState(editState.icon || 'generic');
  const [notes, setNotes] = useState(editState.notes);
  const [groupId, setGroupId] = useState(editState.primary_group_id || NONE_GROUP);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/devices/${editState.device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friendly_name: friendlyName.trim() || null,
          icon: icon || null,
          notes: notes.trim() || null,
          primary_group_id: groupId && groupId !== NONE_GROUP ? groupId : null,
        }),
      });
      const json = (await res.json()) as { ok: boolean; data?: unknown; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Save failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Device updated' });
      onSaved();
      onClose();
    } catch (e) {
      errorToast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <HazoUiDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Edit — ${deviceDisplayName(editState.device)}`}
      actionButtonText="Save"
      actionButtonLoading={saving}
      cancelButtonText="Cancel"
      showCancelButton
      onConfirm={handleSave}
      onCancel={onClose}
      sizeWidth="480px"
    >
      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Friendly name</label>
          <Input
            value={friendlyName}
            onChange={(e) => setFriendlyName(e.target.value)}
            placeholder={editState.device.hostname || editState.device.mac || ''}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Icon</label>
          <Select value={icon} onValueChange={setIcon}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select icon" />
            </SelectTrigger>
            <SelectContent>
              {ICON_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={3}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Group</label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="— none —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_GROUP}>— none —</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id ?? ''}>
                  {g.name ?? g.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </HazoUiDialog>
  );
}

// ---------------------------------------------------------------------------
// Groups grid card
// ---------------------------------------------------------------------------
function GroupCard({
  group,
  onBlock,
}: {
  group: GroupSummary;
  onBlock: (group: GroupSummary, action: 'block' | 'unblock') => void;
}) {
  const initial = (group.name ?? '?').charAt(0).toUpperCase();

  return (
    <div className="relative flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Clickable area → group detail */}
      <Link href={`/explore/groups/${group.id ?? ''}`} className="flex flex-col items-center gap-2 p-4 pb-2 flex-1">
        {/* Avatar */}
        {group.image_file_id ? (
          <img
            src={`/api/groups/image/${group.image_file_id}?variant=thumb`}
            className="h-14 w-14 rounded-full object-cover"
            alt=""
          />
        ) : (
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white"
            style={{ background: group.color ?? '#64748b' }}
          >
            {initial}
          </span>
        )}

        {/* Name */}
        <span className="text-sm font-medium text-foreground text-center leading-tight">
          {group.name ?? group.id}
        </span>

        {/* Online count */}
        <span className="text-xs text-muted-foreground">
          {group.onlineCount} of {group.memberCount} online
        </span>

        {/* Blocked pill */}
        {group.isBlocked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-400">
            <Ban className="h-3 w-3" />
            Blocked
          </span>
        )}
      </Link>

      {/* Block/Unblock button */}
      <div className="px-3 pb-3">
        <button
          onClick={() => onBlock(group, group.isBlocked ? 'unblock' : 'block')}
          className={`w-full rounded-lg py-2 text-sm font-medium transition-colors ${
            group.isBlocked
              ? 'bg-muted text-foreground hover:bg-muted/80'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {group.isBlocked ? 'Unblock all' : 'Block all'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups grid
// ---------------------------------------------------------------------------
function GroupsGrid({
  groupSummaries,
  onBlock,
}: {
  groupSummaries: GroupSummary[];
  onBlock: (group: GroupSummary, action: 'block' | 'unblock') => void;
}) {
  if (groupSummaries.length === 0) {
    return (
      <div className="rounded-lg border border-border p-6">
        <EmptyState title="No groups yet" description="Create groups to organise your devices." />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {groupSummaries.map((g) => (
        <GroupCard key={g.id} group={g} onBlock={onBlock} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request access dialog
// ---------------------------------------------------------------------------
function RequestAccessDialog({
  state,
  onClose,
}: {
  state: RequestAccessState | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!state) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: state.capability,
          scope_type: 'group',
          scope_id: state.groupId,
          note: note.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Request failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Request submitted — a superadmin will review it' });
      setNote('');
      onClose();
    } catch (e) {
      errorToast({ title: 'Request failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <HazoUiDialog
      open={state !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Request access"
      actionButtonText="Submit request"
      actionButtonLoading={submitting}
      cancelButtonText="Cancel"
      showCancelButton
      onConfirm={() => { void handleSubmit(); }}
      onCancel={onClose}
      sizeWidth="420px"
    >
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to {state?.capability === 'group.block' ? 'block' : 'unblock'} this group.
          Submit a request and a superadmin will review it.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Note (optional)</label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why do you need this access?"
          />
        </div>
      </div>
    </HazoUiDialog>
  );
}

// ---------------------------------------------------------------------------
// DevicesScreen
// ---------------------------------------------------------------------------
export function DevicesScreen({ devices, groups, groupSummaries, isSuperadmin, currentDeviceId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const TAB_STORAGE_KEY = 'darylweb:explore:tab';
  const [tab, setTab] = useState<Tab>('devices');
  useEffect(() => {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved === 'devices' || saved === 'groups') setTab(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<DeviceRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [requestAccess, setRequestAccess] = useState<RequestAccessState | null>(null);
  const [timerDevice, setTimerDevice] = useState<DeviceRow | null>(null);

  // Active one-shot timers per device id (for the row countdown badge).
  const [deviceTimers, setDeviceTimers] = useState<Map<string, ActiveTimer>>(new Map());
  // Ticking "now" so countdown labels stay roughly fresh without a refetch.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadTimers = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules?targetType=device');
      const json = (await res.json()) as {
        ok: boolean;
        data?: { timers?: ActiveTimer[]; upcoming?: ActiveTimer[] };
      };
      if (!json.ok || !json.data) return;
      const rows = [...(json.data.timers ?? []), ...(json.data.upcoming ?? [])] as Array<
        ActiveTimer & { status?: string; target_id?: string }
      >;
      const map = new Map<string, ActiveTimer>();
      for (const r of rows) {
        const targetId = r.target_id;
        if (!targetId || !r.run_at || r.status !== 'active') continue;
        const cur = map.get(targetId);
        // Keep the soonest-firing one-shot per device.
        if (!cur || new Date(r.run_at) < new Date(cur.run_at)) {
          map.set(targetId, { id: r.id, action: r.action, run_at: r.run_at });
        }
      }
      setDeviceTimers(map);
    } catch {
      /* best-effort — leave existing badges as-is on a transient failure */
    }
  }, []);

  useEffect(() => { void loadTimers(); }, [loadTimers]);
  // Re-render every 30s so the live timer countdown badges stay current without
  // re-fetching (the worker, not this tick, performs the actual block/unblock at runAt).
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function handleCancelTimer(timer: ActiveTimer) {
    try {
      const res = await fetch(`/api/schedules/${timer.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Cancel failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Timer cancelled' });
      await loadTimers();
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Cancel failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // Counts for the header summary.
  const total = devices.length;
  const onlineCount = devices.filter((d) => d.status === 'online').length;
  const blockedCount = devices.filter((d) => !!d.is_blocked).length;

  // Status filter — the counter labels double as filter buttons.
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'blocked'>('all');
  // If the blocked filter is active but nothing is blocked anymore (e.g. after an
  // unblock + refresh), fall back to "all" so the table doesn't show an empty view.
  const effectiveFilter = statusFilter === 'blocked' && blockedCount === 0 ? 'all' : statusFilter;
  const filteredDevices = devices.filter((d) => {
    if (effectiveFilter === 'online') return d.status === 'online';
    if (effectiveFilter === 'offline') return d.status !== 'online';
    if (effectiveFilter === 'blocked') return !!d.is_blocked;
    return true;
  });
  // The table searches/sorts on `row[key]`, so surface the *resolved* display
  // name (friendly_name → hostname → mac) as its own field. Without this, search
  // only matched friendly_name and missed devices shown via the hostname/mac
  // fallback (e.g. "Google home - kitchen" with an empty friendly_name).
  const tableRows: DeviceTableRow[] = filteredDevices.map((d) => ({
    ...d,
    displayName: deviceDisplayName(d),
  }));
  // Clicking an active (non-"all") chip toggles it back off.
  const toggleFilter = (f: 'online' | 'offline' | 'blocked') =>
    setStatusFilter((cur) => (cur === f ? 'all' : f));

  // ------------------------------------------------------------------
  // Refresh: re-sync devices AND pull live block state from the router.
  // (Unlike the worker, this mirrors router truth — so a block/unblock done
  // directly on the router is reflected here, clearing a stale badge.)
  // ------------------------------------------------------------------
  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/sync/refresh', { method: 'POST' });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { summary?: { seen: number; inserted: number; block_pulled: number } };
        error?: { message: string };
      };
      if (!json.ok) {
        errorToast({ title: 'Refresh failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      const s = json.data?.summary;
      const extra = s?.block_pulled ? ` · ${s.block_pulled} block change(s)` : '';
      successToast({ title: 'Refreshed from router', description: s ? `${s.seen} device(s) seen${extra}` : undefined });
      void loadTimers();
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Refresh failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setRefreshing(false);
    }
  }

  // ------------------------------------------------------------------
  // Block / unblock a group (capability-gated)
  // ------------------------------------------------------------------
  async function handleGroupBlock(group: GroupSummary, action: 'block' | 'unblock') {
    const groupId = group.id ?? '';
    try {
      const res = await fetch(`/api/groups/${groupId}/${action}`, { method: 'POST' });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message: string; code?: string };
        memberCount?: number;
        affected?: string[];
        skippedOffline?: string[];
      };
      if (!json.ok) {
        if (json.error?.code === 'FORBIDDEN' || res.status === 403) {
          setRequestAccess({
            groupId,
            capability: action === 'block' ? 'group.block' : 'group.unblock',
          });
          return;
        }
        errorToast({ title: `${action === 'block' ? 'Block' : 'Unblock'} failed`, description: json.error?.message ?? 'Unknown error' });
        return;
      }
      const affected = json.affected?.length ?? 0;
      const skipped = json.skippedOffline?.length ?? 0;
      const desc = skipped > 0 ? `${action === 'block' ? 'Blocked' : 'Unblocked'} ${affected} · ${skipped} offline skipped` : undefined;
      successToast({ title: action === 'block' ? 'Group blocked' : 'Group unblocked', description: desc });
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: `${action === 'block' ? 'Block' : 'Unblock'} failed`, description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // ------------------------------------------------------------------
  // Acknowledge a "new" device
  // ------------------------------------------------------------------
  async function handleAcknowledge(device: DeviceRow) {
    try {
      const res = await fetch(`/api/devices/${device.id}/acknowledge`, { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Acknowledge failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Device acknowledged' });
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Acknowledge failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // ------------------------------------------------------------------
  // Block / unblock a device (superadmin only)
  // ------------------------------------------------------------------
  async function handleToggleBlock(device: DeviceRow) {
    const blocking = !device.is_blocked;
    const url = `/api/devices/${device.id}/${blocking ? 'block' : 'unblock'}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: blocking ? JSON.stringify({ reason: null }) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: blocking ? 'Block failed' : 'Unblock failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: blocking ? 'Device blocked' : 'Device unblocked' });
      void loadTimers();
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: blocking ? 'Block failed' : 'Unblock failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // ------------------------------------------------------------------
  // Open edit dialog
  // ------------------------------------------------------------------
  function openEdit(device: DeviceRow) {
    setEditState({
      device,
      friendly_name: device.friendly_name ?? '',
      icon: device.icon ?? 'generic',
      notes: device.notes ?? '',
      primary_group_id: device.primary_group_id ?? '',
    });
  }

  // ------------------------------------------------------------------
  // Columns
  // ------------------------------------------------------------------
  const columns: TableColumn<DeviceTableRow>[] = [
    {
      key: 'displayName',
      label: 'Name',
      sortable: true,
      searchable: true,
      cell: (d) => {
        const IconComp = ICONS[d.icon ?? ''] ?? HardDrive;
        const timer = d.id ? deviceTimers.get(d.id) : undefined;
        return (
          <span className="flex items-center gap-2">
            <IconComp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground">{deviceDisplayName(d)}</span>
            {currentDeviceId && d.id === currentDeviceId && <ThisDeviceBadge />}
            {!!d.is_blocked && <BlockedBadge />}
            {timer && (
              <TimerBadge
                timer={timer}
                nowMs={nowMs}
                onCancel={() => void handleCancelTimer(timer)}
              />
            )}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      cell: (d) => <StatusChip status={d.status} />,
    },
    {
      key: 'primary_group_id',
      label: 'Group',
      cell: (d) => <GroupBadge group={groupById(groups, d.primary_group_id)} />,
    },
    {
      key: 'current_ip',
      label: 'IP / Band',
      cell: (d) => (
        <span className="text-sm text-foreground">
          {d.current_ip ?? '—'}
          {d.last_band && (
            <span className="ml-1 text-xs text-muted-foreground">{d.last_band}</span>
          )}
        </span>
      ),
    },
    {
      key: 'is_new',
      label: 'Actions',
      cell: (d) => {
        const timer = d.id ? deviceTimers.get(d.id) : undefined;
        return (
        <span className="flex items-center gap-2">
          {!!d.is_new && (
            <button
              onClick={(e) => { e.stopPropagation(); void handleAcknowledge(d); }}
              disabled={isPending}
              className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50"
            >
              New
            </button>
          )}
          {isSuperadmin && d.id && !timer && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={(e) => { e.stopPropagation(); setTimerDevice(d); }}
              className="h-7 w-7 p-0"
              aria-label={d.is_blocked ? 'Unblock for a period' : 'Block for a period'}
              title={d.is_blocked ? 'Unblock for a period' : 'Block for a period'}
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>
          )}
          {isSuperadmin && (
            d.is_blocked ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={(e) => { e.stopPropagation(); void handleToggleBlock(d); }}
                className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                aria-label="Unblock device"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={(e) => { e.stopPropagation(); setConfirmBlock(d); }}
                className="h-7 w-7 p-0"
                aria-label="Block device"
              >
                <Ban className="h-3.5 w-3.5" />
              </Button>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={(e) => { e.stopPropagation(); openEdit(d); }}
            className="h-7 w-7 p-0"
            aria-label="Edit device"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </span>
        );
      },
    },
  ];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Explore</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRefresh()}
          disabled={refreshing || isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-1 w-fit">
        {(['devices', 'groups'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'groups' ? (
        <GroupsGrid
          groupSummaries={groupSummaries}
          onBlock={(g, action) => { void handleGroupBlock(g, action); }}
        />
      ) : (
        <div className="rounded-lg border border-border">
          {/* Device counter — labels double as status filters */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-border px-3 py-2">
            <FilterChip
              active={effectiveFilter === 'all'}
              onClick={() => setStatusFilter('all')}
              colorClass="text-foreground"
              activeClass="bg-muted text-foreground"
            >
              {total} {total === 1 ? 'device' : 'devices'}
            </FilterChip>
            <FilterChip
              active={effectiveFilter === 'online'}
              onClick={() => toggleFilter('online')}
              colorClass="text-green-700"
              activeClass="bg-green-100"
            >
              <Wifi className="h-3.5 w-3.5" />
              {onlineCount} online
            </FilterChip>
            <FilterChip
              active={effectiveFilter === 'offline'}
              onClick={() => toggleFilter('offline')}
              colorClass="text-muted-foreground"
              activeClass="bg-muted text-foreground"
            >
              <WifiOff className="h-3.5 w-3.5" />
              {total - onlineCount} offline
            </FilterChip>
            {blockedCount > 0 && (
              <FilterChip
                active={effectiveFilter === 'blocked'}
                onClick={() => toggleFilter('blocked')}
                colorClass="text-red-600"
                activeClass="bg-red-100"
              >
                <Ban className="h-3.5 w-3.5" />
                {blockedCount} blocked
              </FilterChip>
            )}
          </div>
          <HazoUiTable<DeviceTableRow>
            columns={columns}
            rows={tableRows}
            getRowKey={(d) => d.id ?? ''}
            enableSearch
            searchPlaceholder="Search devices…"
            loading={isPending}
            onRowClick={(d) => router.push(`/explore/${d.id}`)}
            empty={
              effectiveFilter === 'all' ? (
                <EmptyState
                  title="No devices yet"
                  description="Run a sync or start the worker."
                />
              ) : (
                <EmptyState
                  title={`No ${effectiveFilter} devices`}
                  description="Try a different filter or clear it to see all devices."
                />
              )
            }
            mobileCardFallback
          />
        </div>
      )}

      {/* Edit dialog */}
      {editState && (
        <EditDialog
          editState={editState}
          groups={groups}
          onClose={() => setEditState(null)}
          onSaved={() => startTransition(() => { router.refresh(); })}
        />
      )}

      {/* Quick timer dialog — block-for / unblock-for a period */}
      {timerDevice && (
        <QuickTimerDialog
          device={timerDevice}
          onClose={() => setTimerDevice(null)}
          onCreated={() => {
            void loadTimers();
            startTransition(() => { router.refresh(); });
          }}
        />
      )}

      {/* Block confirm dialog */}
      {confirmBlock && (
        <HazoUiDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmBlock(null); }}
          title={`Block ${deviceDisplayName(confirmBlock)}?`}
          actionButtonText="Block"
          cancelButtonText="Cancel"
          showCancelButton
          onConfirm={() => { const d = confirmBlock; setConfirmBlock(null); void handleToggleBlock(d); }}
          onCancel={() => setConfirmBlock(null)}
          sizeWidth="420px"
        >
          <div className="p-4 text-sm text-muted-foreground">
            This cuts internet access for this device at the router. You can unblock it again at any time.
          </div>
        </HazoUiDialog>
      )}

      {/* Request access dialog */}
      <RequestAccessDialog
        state={requestAccess}
        onClose={() => setRequestAccess(null)}
      />

      {/* FAB — Create Group (superadmin only, shown on groups tab) */}
      {tab === 'groups' && isSuperadmin && (
        <Link
          href="/explore/groups/new"
          className="fixed bottom-24 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors z-50"
          aria-label="Create group"
        >
          <Plus className="h-6 w-6" />
        </Link>
      )}
    </div>
  );
}
