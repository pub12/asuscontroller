'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Ban,
  ShieldCheck,
  Trash2,
  Plus,
  X,
  Search,
  Pencil,
} from 'lucide-react';
import {
  Button,
  Input,
  HazoUiDialog,
  successToast,
  errorToast,
} from 'hazo_ui';
import type { GroupRow, DeviceRow } from '@/server/devices/deviceService';
import type { GroupSummary } from '@/server/groups/groupService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Props {
  group: GroupRow;
  members: (DeviceRow & { is_blocked: number })[];
  allDevices: DeviceRow[];
  isSuperadmin: boolean;
}

interface RequestAccessState {
  groupId: string;
  capability: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deviceDisplayName(d: DeviceRow): string {
  return d.friendly_name ?? d.hostname ?? d.mac ?? d.id ?? '—';
}

const COLOR_PALETTE = [
  '#3b82f6',
  '#0d7059',
  '#8b5cf6',
  '#a855f7',
  '#f97316',
  '#64748b',
];

// ---------------------------------------------------------------------------
// Request Access Dialog
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
// GroupDetailScreen
// ---------------------------------------------------------------------------
export function GroupDetailScreen({ group, members, allDevices, isSuperadmin }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Derive stats from members
  const memberCount = members.length;
  const onlineCount = members.filter((m) => m.status === 'online').length;
  const isBlocked = memberCount >= 1 && members.every((m) => Number(m.is_blocked) === 1);

  // Dialogs
  const [requestAccess, setRequestAccess] = useState<RequestAccessState | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);

  // Edit state
  const [editName, setEditName] = useState(group.name ?? '');
  const [editType, setEditType] = useState<string>(group.type ?? 'generic');
  const [editColor, setEditColor] = useState<string>(group.color ?? COLOR_PALETTE[0]!);
  const [editImageFileId, setEditImageFileId] = useState<string | null>(group.image_file_id ?? null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(
    group.image_file_id ? `/api/groups/image/${group.image_file_id}` : null,
  );
  const [editSaving, setEditSaving] = useState(false);
  const [editUploading, setEditUploading] = useState(false);

  // Add members state
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedAddIds, setSelectedAddIds] = useState<Set<string>>(new Set());
  const [addingSaving, setAddingSaving] = useState(false);

  // Members not already in the group
  const existingMemberIds = new Set(members.map((m) => m.id).filter(Boolean) as string[]);
  const addableDevices = allDevices.filter((d) => d.id && !existingMemberIds.has(d.id));
  const filteredAddable = addableDevices.filter((d) => {
    const q = memberSearch.toLowerCase();
    if (!q) return true;
    return deviceDisplayName(d).toLowerCase().includes(q);
  });

  const groupId = group.id ?? '';

  // -----------------------------------------------------------------------
  // Block / Unblock group
  // -----------------------------------------------------------------------
  async function handleGroupBlock(action: 'block' | 'unblock') {
    try {
      const res = await fetch(`/api/groups/${groupId}/${action}`, { method: 'POST' });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message: string; code?: string };
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

  // -----------------------------------------------------------------------
  // Edit group
  // -----------------------------------------------------------------------
  async function handleEditImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/groups/image', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { image_file_id?: string };
        error?: { message: string; code?: string };
      };
      if (!json.ok) {
        errorToast({ title: 'Upload failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      const fileId = json.data?.image_file_id;
      if (fileId) {
        setEditImageFileId(fileId);
        setEditImagePreview(`/api/groups/image/${fileId}`);
      }
    } catch (err) {
      errorToast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setEditUploading(false);
    }
  }

  async function handleSaveEdit() {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          type: editType || undefined,
          color: editColor || undefined,
          image_file_id: editImageFileId ?? null,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Save failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Group updated' });
      setShowEditGroup(false);
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setEditSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Remove member
  // -----------------------------------------------------------------------
  async function handleRemoveMember(deviceId: string) {
    try {
      const res = await fetch(`/api/groups/${groupId}/members/${deviceId}`, { method: 'DELETE' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Remove failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Member removed' });
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Remove failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // -----------------------------------------------------------------------
  // Add members
  // -----------------------------------------------------------------------
  function toggleAddDevice(id: string) {
    setSelectedAddIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleAddMembers() {
    if (selectedAddIds.size === 0) return;
    setAddingSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: Array.from(selectedAddIds) }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Add members failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: `${selectedAddIds.size} member(s) added` });
      setSelectedAddIds(new Set());
      setMemberSearch('');
      setShowAddMembers(false);
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Add members failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setAddingSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Delete group
  // -----------------------------------------------------------------------
  async function handleDelete() {
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Delete failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Group deleted' });
      startTransition(() => { router.push('/explore'); });
    } catch (e) {
      errorToast({ title: 'Delete failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  const initial = (group.name ?? '?').charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-500 hover:text-gray-700"
        aria-label="Go back"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="flex items-center gap-4">
        {group.image_file_id ? (
          <img
            src={`/api/groups/image/${group.image_file_id}?variant=thumb`}
            className="h-16 w-16 rounded-full object-cover flex-shrink-0"
            alt=""
          />
        ) : (
          <span
            className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white"
            style={{ background: group.color ?? '#64748b' }}
          >
            {initial}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 truncate">{group.name ?? group.id}</h1>
          <p className="text-sm text-gray-500">{onlineCount} of {memberCount} online</p>
          {isBlocked && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              <Ban className="h-3 w-3" />
              Blocked
            </span>
          )}
        </div>
        {/* Block / Unblock */}
        <Button
          variant={isBlocked ? 'outline' : 'default'}
          size="sm"
          onClick={() => { void handleGroupBlock(isBlocked ? 'unblock' : 'block'); }}
          disabled={isPending}
          className={isBlocked ? '' : 'bg-teal-700 text-white hover:bg-teal-800'}
        >
          {isBlocked ? (
            <><ShieldCheck className="mr-1 h-4 w-4" /> Unblock all</>
          ) : (
            <><Ban className="mr-1 h-4 w-4" /> Block all</>
          )}
        </Button>
      </div>

      {/* Members */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-800">Members ({memberCount})</h2>
          {isSuperadmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddMembers(true)}
              className="h-7 gap-1 px-2 text-xs"
            >
              <Plus className="h-3 w-3" /> Add
            </Button>
          )}
        </div>
        {members.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No members yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    m.status === 'online' ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className="flex-1 truncate text-sm text-gray-800">
                  {deviceDisplayName(m)}
                </span>
                {Number(m.is_blocked) === 1 && (
                  <span className="text-xs text-red-600">Blocked</span>
                )}
                {isSuperadmin && (
                  <button
                    onClick={() => { void handleRemoveMember(m.id ?? ''); }}
                    disabled={isPending}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                    aria-label={`Remove ${deviceDisplayName(m)}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Manage section — superadmin only */}
      {isSuperadmin && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Manage</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditGroup(true)}
              className="gap-1"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit group
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete group
            </Button>
          </div>
        </section>
      )}

      {/* Analytics placeholder */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-800 mb-2">Analytics</h2>
        <p className="text-sm text-gray-500">Coming soon — usage stats and bandwidth analytics for this group.</p>
      </section>

      {/* Schedules placeholder */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-800 mb-2">Schedules</h2>
        <p className="text-sm text-gray-500">Coming soon — time-based access schedules for this group.</p>
      </section>

      {/* Request access dialog */}
      <RequestAccessDialog
        state={requestAccess}
        onClose={() => setRequestAccess(null)}
      />

      {/* Delete confirm dialog */}
      <HazoUiDialog
        open={showDeleteConfirm}
        onOpenChange={(o) => { if (!o) setShowDeleteConfirm(false); }}
        title={`Delete "${group.name ?? 'this group'}"?`}
        actionButtonText="Delete"
        cancelButtonText="Cancel"
        showCancelButton
        onConfirm={() => { setShowDeleteConfirm(false); void handleDelete(); }}
        onCancel={() => setShowDeleteConfirm(false)}
        sizeWidth="420px"
      >
        <div className="p-4 text-sm text-gray-600">
          This will permanently delete the group and remove all member assignments. Devices will not be deleted.
        </div>
      </HazoUiDialog>

      {/* Edit group dialog */}
      <HazoUiDialog
        open={showEditGroup}
        onOpenChange={(o) => { if (!o) setShowEditGroup(false); }}
        title="Edit group"
        actionButtonText="Save"
        actionButtonLoading={editSaving}
        cancelButtonText="Cancel"
        showCancelButton
        onConfirm={() => { void handleSaveEdit(); }}
        onCancel={() => setShowEditGroup(false)}
        sizeWidth="480px"
      >
        <div className="space-y-4 p-4">
          {/* Image upload */}
          <div className="flex flex-col items-center gap-2">
            <label className="relative cursor-pointer">
              {editImagePreview ? (
                <img
                  src={editImagePreview}
                  alt="Group avatar"
                  className="h-16 w-16 rounded-full object-cover border-2 border-gray-200"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-gray-300 bg-gray-50">
                  <span className="text-xl text-gray-400">👥</span>
                </div>
              )}
              <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-teal-700 text-white text-xs">
                {editUploading ? '…' : '+'}
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleEditImageChange}
                disabled={editUploading}
              />
            </label>
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              {(['person', 'generic'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEditType(t)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                    editType === t
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Color</label>
            <div className="flex gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditColor(c)}
                  className={`h-8 w-8 rounded-full transition-transform ${
                    editColor === c ? 'ring-2 ring-offset-2 ring-teal-700 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
      </HazoUiDialog>

      {/* Add members dialog */}
      <HazoUiDialog
        open={showAddMembers}
        onOpenChange={(o) => { if (!o) { setShowAddMembers(false); setSelectedAddIds(new Set()); setMemberSearch(''); } }}
        title="Add members"
        actionButtonText={`Add ${selectedAddIds.size > 0 ? `(${selectedAddIds.size})` : ''}`}
        actionButtonLoading={addingSaving}
        cancelButtonText="Cancel"
        showCancelButton
        onConfirm={() => { void handleAddMembers(); }}
        onCancel={() => { setShowAddMembers(false); setSelectedAddIds(new Set()); setMemberSearch(''); }}
        sizeWidth="480px"
      >
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search devices…"
              className="pl-8"
            />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1.5">
            {filteredAddable.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-500">
                {addableDevices.length === 0 ? 'All devices are already members.' : 'No devices match your search.'}
              </p>
            )}
            {filteredAddable.map((d) => {
              const id = d.id ?? '';
              const checked = selectedAddIds.has(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleAddDevice(id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    checked
                      ? 'border-teal-300 bg-teal-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      d.status === 'online' ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  />
                  <span className="flex-1 truncate text-sm text-gray-800">{deviceDisplayName(d)}</span>
                  <div
                    className={`h-5 w-5 flex-shrink-0 rounded border transition-colors ${
                      checked ? 'border-teal-700 bg-teal-700' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {checked && (
                      <svg viewBox="0 0 20 20" className="fill-white" aria-hidden>
                        <path d="M7 10l2.5 2.5L14 7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </HazoUiDialog>
    </div>
  );
}
