'use client';

import { useState, useTransition } from 'react';
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
        online ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
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
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
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
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
      <MapPin className="h-3 w-3" />
      This device
    </span>
  );
}

// ---------------------------------------------------------------------------
// Group badge
// ---------------------------------------------------------------------------
function GroupBadge({ group }: { group: GroupRow | undefined }) {
  if (!group) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Friendly name</label>
          <Input
            value={friendlyName}
            onChange={(e) => setFriendlyName(e.target.value)}
            placeholder={editState.device.hostname || editState.device.mac || ''}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Icon</label>
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
          <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={3}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Group</label>
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
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
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
        <span className="text-sm font-medium text-gray-900 text-center leading-tight">
          {group.name ?? group.id}
        </span>

        {/* Online count */}
        <span className="text-xs text-gray-500">
          {group.onlineCount} of {group.memberCount} online
        </span>

        {/* Blocked pill */}
        {group.isBlocked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
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
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-teal-700 text-white hover:bg-teal-800'
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
      <div className="rounded-lg border border-gray-200 p-6">
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
        <p className="text-sm text-gray-600">
          You don&apos;t have permission to {state?.capability === 'group.block' ? 'block' : 'unblock'} this group.
          Submit a request and a superadmin will review it.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Note (optional)</label>
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
  const [tab, setTab] = useState<Tab>('devices');
  const [editState, setEditState] = useState<EditState | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<DeviceRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [requestAccess, setRequestAccess] = useState<RequestAccessState | null>(null);

  // Counts for the header summary.
  const total = devices.length;
  const onlineCount = devices.filter((d) => d.status === 'online').length;
  const blockedCount = devices.filter((d) => !!d.is_blocked).length;

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
  const columns: TableColumn<DeviceRow>[] = [
    {
      key: 'friendly_name',
      label: 'Name',
      sortable: true,
      searchable: true,
      cell: (d) => {
        const IconComp = ICONS[d.icon ?? ''] ?? HardDrive;
        return (
          <span className="flex items-center gap-2">
            <IconComp className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <span className="font-medium text-gray-800">{deviceDisplayName(d)}</span>
            {currentDeviceId && d.id === currentDeviceId && <ThisDeviceBadge />}
            {!!d.is_blocked && <BlockedBadge />}
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
        <span className="text-sm text-gray-700">
          {d.current_ip ?? '—'}
          {d.last_band && (
            <span className="ml-1 text-xs text-gray-400">{d.last_band}</span>
          )}
        </span>
      ),
    },
    {
      key: 'is_new',
      label: 'Actions',
      cell: (d) => (
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
      ),
    },
  ];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Explore</h1>
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
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        {(['devices', 'groups'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
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
        <div className="rounded-lg border border-gray-200">
          {/* Device counter */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 px-4 py-2.5 text-sm">
            <span className="font-medium text-gray-800">
              {total} {total === 1 ? 'device' : 'devices'}
            </span>
            <span className="text-gray-400">·</span>
            <span className="inline-flex items-center gap-1 text-green-700">
              <Wifi className="h-3.5 w-3.5" />
              {onlineCount} online
            </span>
            <span className="inline-flex items-center gap-1 text-gray-500">
              <WifiOff className="h-3.5 w-3.5" />
              {total - onlineCount} offline
            </span>
            {blockedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-red-600">
                <Ban className="h-3.5 w-3.5" />
                {blockedCount} blocked
              </span>
            )}
          </div>
          <HazoUiTable<DeviceRow>
            columns={columns}
            rows={devices}
            getRowKey={(d) => d.id ?? ''}
            enableSearch
            searchPlaceholder="Search devices…"
            loading={isPending}
            onRowClick={(d) => router.push(`/explore/${d.id}`)}
            empty={
              <EmptyState
                title="No devices yet"
                description="Run a sync or start the worker."
              />
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
          <div className="p-4 text-sm text-gray-600">
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
          className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg hover:bg-teal-800 transition-colors z-10"
          aria-label="Create group"
        >
          <Plus className="h-6 w-6" />
        </Link>
      )}
    </div>
  );
}
