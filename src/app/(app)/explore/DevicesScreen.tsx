'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
  isSuperadmin: boolean;
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
// Groups list (read-only)
// ---------------------------------------------------------------------------
function GroupsList({ groups }: { groups: GroupRow[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <EmptyState title="No groups yet" description="Create groups to organise your devices." />
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {groups.map((g) => (
        <li
          key={g.id}
          className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
        >
          {g.color && (
            <span
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full"
              style={{ background: g.color }}
            />
          )}
          <div>
            <p className="text-sm font-medium text-gray-800">{g.name ?? g.id}</p>
            {g.description && (
              <p className="mt-0.5 text-xs text-gray-500">{g.description}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// DevicesScreen
// ---------------------------------------------------------------------------
export function DevicesScreen({ devices, groups, isSuperadmin }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>('devices');
  const [editState, setEditState] = useState<EditState | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<DeviceRow | null>(null);

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
        <GroupsList groups={groups} />
      ) : (
        <div className="rounded-lg border border-gray-200">
          <HazoUiTable<DeviceRow>
            columns={columns}
            rows={devices}
            getRowKey={(d) => d.id ?? ''}
            enableSearch
            searchPlaceholder="Search devices…"
            loading={isPending}
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
    </div>
  );
}
