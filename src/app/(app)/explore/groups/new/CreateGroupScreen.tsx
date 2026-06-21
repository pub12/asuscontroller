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
  return <Comp className="h-5 w-5 text-gray-500" />;
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
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Go back"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold text-gray-900">Create Group</h1>
      </div>

      {/* Image upload */}
      <div className="flex flex-col items-center gap-3">
        <label className="relative cursor-pointer">
          {imagePreview ? (
            <img
              src={imagePreview}
              alt="Group avatar"
              className="h-20 w-20 rounded-full object-cover border-2 border-gray-200"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-gray-300 bg-gray-50">
              <span className="text-2xl text-gray-400">👥</span>
            </div>
          )}
          {/* Camera badge */}
          <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white text-xs">
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
        {uploading && <p className="text-xs text-gray-500">Uploading…</p>}
      </div>

      {/* Group name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Group Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Family, Kids, Guest Devices"
        />
      </div>

      {/* Group type toggle */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Group Type</label>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          {(['person', 'generic'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                type === t
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Color</label>
        <div className="flex gap-3">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-9 w-9 rounded-full transition-transform ${
                color === c ? 'ring-2 ring-offset-2 ring-teal-700 scale-110' : 'hover:scale-105'
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
          <label className="text-sm font-medium text-gray-700">Add Members</label>
          <span className="text-sm text-teal-700 font-medium">
            {selectedDeviceIds.size} Selected
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
            <p className="py-4 text-center text-sm text-gray-500">No devices found.</p>
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
                    ? 'border-teal-300 bg-teal-50'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
                  <DeviceIconComp icon={deviceIcon(d)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {deviceDisplayName(d)}
                  </p>
                  {d.current_ip && (
                    <p className="truncate text-xs text-gray-500">{d.current_ip}</p>
                  )}
                </div>
                {/* Checkbox */}
                <div
                  className={`h-5 w-5 flex-shrink-0 rounded border transition-colors ${
                    checked
                      ? 'border-teal-700 bg-teal-700'
                      : 'border-gray-300 bg-white'
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
          className="w-full bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50 py-3 rounded-xl text-sm font-semibold"
        >
          {isLoading ? 'Creating…' : '👥 Create Group'}
        </Button>
      </div>
    </div>
  );
}
