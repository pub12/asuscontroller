'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  HardDrive,
  Laptop,
  Smartphone,
  Tablet,
  Tv,
  Search,
} from 'lucide-react';
import {
  Button,
  Input,
  successToast,
  errorToast,
} from 'hazo_ui';
import type { DeviceRow } from '@/server/devices/deviceService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#0d7059', // teal-700 (matches app brand)
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#f97316', // orange
  '#64748b', // slate
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deviceDisplayName(d: DeviceRow): string {
  return d.friendly_name ?? d.hostname ?? d.mac ?? d.id ?? '—';
}

function deviceIcon(d: DeviceRow): string {
  return d.icon ?? 'generic';
}

type DeviceIconName = 'laptop' | 'smartphone' | 'tablet' | 'tv' | 'generic';

function DeviceIconComp({ icon }: { icon: string }) {
  const map: Record<DeviceIconName, React.ComponentType<{ className?: string }>> = {
    laptop: Laptop,
    smartphone: Smartphone,
    tablet: Tablet,
    tv: Tv,
    generic: HardDrive,
  };
  const Comp = map[icon as DeviceIconName] ?? HardDrive;
  return <Comp className="h-5 w-5 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// CreateGroupScreen
// ---------------------------------------------------------------------------
interface Props {
  devices: DeviceRow[];
}

export function CreateGroupScreen({ devices }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'person' | 'generic'>('person');
  const [color, setColor] = useState<string>(COLOR_PALETTE[0]!);
  const [imageFileId, setImageFileId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [deviceSearch, setDeviceSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Filtered devices for the member picker
  const filteredDevices = devices.filter((d) => {
    const q = deviceSearch.toLowerCase();
    if (!q) return true;
    const label = deviceDisplayName(d).toLowerCase();
    return label.includes(q);
  });

  // -----------------------------------------------------------------------
  // Image upload
  // -----------------------------------------------------------------------
  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
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
        if (json.error?.code === 'VALIDATION_FAILED') {
          errorToast({ title: 'Invalid image', description: json.error.message });
        } else {
          errorToast({ title: 'Upload failed', description: json.error?.message ?? 'Unknown error' });
        }
        return;
      }
      const fileId = json.data?.image_file_id;
      if (fileId) {
        setImageFileId(fileId);
        setImagePreview(`/api/groups/image/${fileId}`);
      }
    } catch (err) {
      errorToast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setUploading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Toggle device selection
  // -----------------------------------------------------------------------
  function toggleDevice(id: string) {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------
  async function handleSubmit() {
    if (!name.trim()) {
      errorToast({ title: 'Name required', description: 'Please enter a group name.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          color,
          image_file_id: imageFileId ?? undefined,
          member_ids: selectedDeviceIds.size > 0 ? Array.from(selectedDeviceIds) : undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { group?: { id?: string } };
        error?: { message: string };
      };
      if (!json.ok) {
        errorToast({ title: 'Create failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Group created' });
      const groupId = json.data?.group?.id;
      startTransition(() => {
        router.push(groupId ? `/explore/groups/${groupId}` : '/explore');
      });
    } catch (err) {
      errorToast({ title: 'Create failed', description: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSubmitting(false);
    }
  }

  const isLoading = submitting || isPending;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Go back"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold text-foreground">Create Group</h1>
      </div>

      {/* Image upload */}
      <div className="flex flex-col items-center gap-3">
        <label className="relative cursor-pointer">
          {imagePreview ? (
            <img
              src={imagePreview}
              alt="Group avatar"
              className="h-20 w-20 rounded-full object-cover border-2 border-border"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border bg-muted">
              <span className="text-2xl text-muted-foreground">👥</span>
            </div>
          )}
          {/* Camera badge */}
          <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
            {uploading ? '…' : '+'}
          </span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleImageChange}
            disabled={uploading}
          />
        </label>
        {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
      </div>

      {/* Group name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">Group Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Family, Kids, Guest Devices"
        />
      </div>

      {/* Group type toggle */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">Group Type</label>
        <div className="flex rounded-lg border border-border bg-muted p-1">
          {(['person', 'generic'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                type === t
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">Color</label>
        <div className="flex gap-3">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-9 w-9 rounded-full transition-transform ${
                color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'
              }`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>

      {/* Member picker */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">Add Members</label>
          <span className="text-sm text-primary font-medium">
            {selectedDeviceIds.size} Selected
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={deviceSearch}
            onChange={(e) => setDeviceSearch(e.target.value)}
            placeholder="Search devices…"
            className="pl-8"
          />
        </div>

        {/* Device list */}
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {filteredDevices.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No devices found.</p>
          )}
          {filteredDevices.map((d) => {
            const id = d.id ?? '';
            const checked = selectedDeviceIds.has(id);
            return (
              <button
                key={id}
                onClick={() => toggleDevice(id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  checked
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                  <DeviceIconComp icon={deviceIcon(d)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {deviceDisplayName(d)}
                  </p>
                  {d.current_ip && (
                    <p className="truncate text-xs text-muted-foreground">{d.current_ip}</p>
                  )}
                </div>
                {/* Checkbox */}
                <div
                  className={`h-5 w-5 flex-shrink-0 rounded border transition-colors ${
                    checked
                      ? 'border-primary bg-primary'
                      : 'border-border bg-card'
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

      {/* Submit button */}
      <div className="pb-6">
        <Button
          onClick={() => { void handleSubmit(); }}
          disabled={isLoading || !name.trim()}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 py-3 rounded-xl text-sm font-semibold"
        >
          {isLoading ? 'Creating…' : '👥 Create Group'}
        </Button>
      </div>
    </div>
  );
}
