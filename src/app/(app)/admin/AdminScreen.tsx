'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  HazoUiTable,
  type TableColumn,
  EmptyState,
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  HazoUiDialog,
  successToast,
  errorToast,
} from 'hazo_ui';
import type { GrantRow, RequestRow } from '@/server/permissions/grantsService';
import type { SafeUserRow } from './page';

// capabilities.ts has no 'server-only' import, so it's safe to import directly.
// (Verified: the file only exports const CAPABILITIES and helpers — no server imports.)
import { CAPABILITIES } from '@/server/permissions/capabilities';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Tab = 'users' | 'pending' | 'grants';

interface Props {
  grants: GrantRow[];
  requests: RequestRow[];
  users: SafeUserRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function scopeLabel(scope_type: string | null, scope_id: string | null): string {
  if (!scope_type || scope_type === 'global') return 'Global';
  return `${scope_type}: ${scope_id ?? '—'}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// New Grant Dialog
// ---------------------------------------------------------------------------
interface NewGrantDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  userEmails: string[];
}

function NewGrantDialog({ open, onOpenChange, onCreated, userEmails }: NewGrantDialogProps) {
  const [subject, setSubject] = useState('');
  const [capability, setCapability] = useState<string>(CAPABILITIES[0]);
  const [scopeType, setScopeType] = useState<'global' | 'group'>('global');
  const [scopeId, setScopeId] = useState('');
  const [saving, setSaving] = useState(false);

  // Suggest the first matching email when the user types
  const suggestion = userEmails.find(
    (e) => e.toLowerCase().startsWith(subject.toLowerCase()) && e !== subject,
  );

  async function handleCreate() {
    if (!subject.trim()) {
      errorToast({ title: 'Subject required', description: 'Enter the user email.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          capability,
          scopeType,
          scopeId: scopeType === 'group' ? (scopeId.trim() || null) : null,
        }),
      });
      const json = (await res.json()) as { ok: boolean; data?: unknown; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Create failed', description: (json as { error?: { message: string } }).error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Grant created' });
      onCreated();
      onOpenChange(false);
      // reset
      setSubject('');
      setCapability(CAPABILITIES[0]);
      setScopeType('global');
      setScopeId('');
    } catch (e) {
      errorToast({ title: 'Create failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <HazoUiDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New grant"
      actionButtonText="Create grant"
      actionButtonLoading={saving}
      cancelButtonText="Cancel"
      showCancelButton
      onConfirm={handleCreate}
      onCancel={() => onOpenChange(false)}
      sizeWidth="480px"
    >
      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Subject (email)</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="user@example.com"
          />
          {suggestion && (
            <button
              type="button"
              onClick={() => setSubject(suggestion)}
              className="mt-1 text-xs text-indigo-600 hover:underline"
            >
              {suggestion}
            </button>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Capability</label>
          <Select value={capability} onValueChange={setCapability}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select capability" />
            </SelectTrigger>
            <SelectContent>
              {CAPABILITIES.map((cap) => (
                <SelectItem key={cap} value={cap}>
                  {cap}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Scope type</label>
          <Select value={scopeType} onValueChange={(v) => setScopeType(v as 'global' | 'group')}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global</SelectItem>
              <SelectItem value="group">Group</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {scopeType === 'group' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Group ID</label>
            <Input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="group-id or name"
            />
          </div>
        )}
      </div>
    </HazoUiDialog>
  );
}

// ---------------------------------------------------------------------------
// AdminScreen
// ---------------------------------------------------------------------------
export function AdminScreen({ grants, requests, users }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>('pending');
  const [newGrantOpen, setNewGrantOpen] = useState(false);

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const userEmails = users.map((u) => u.email_address);

  function refresh() {
    startTransition(() => { router.refresh(); });
  }

  // ------------------------------------------------------------------
  // Approve / Decline request
  // ------------------------------------------------------------------
  async function handleDecide(id: string, action: 'approve' | 'decline') {
    try {
      const res = await fetch(`/api/requests/${id}/${action}`, { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: `${action === 'approve' ? 'Approve' : 'Decline'} failed`, description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: action === 'approve' ? 'Request approved' : 'Request declined' });
      refresh();
    } catch (e) {
      errorToast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // ------------------------------------------------------------------
  // Revoke grant
  // ------------------------------------------------------------------
  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/grants/${id}`, { method: 'DELETE' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Revoke failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Grant revoked' });
      refresh();
    } catch (e) {
      errorToast({ title: 'Revoke failed', description: e instanceof Error ? e.message : 'Network error' });
    }
  }

  // ------------------------------------------------------------------
  // Columns
  // ------------------------------------------------------------------
  const requestColumns: TableColumn<RequestRow>[] = [
    { key: 'subject', label: 'Subject', sortable: true, searchable: true },
    { key: 'capability', label: 'Capability', sortable: true },
    {
      key: 'scope_type',
      label: 'Scope',
      cell: (r) => <span className="text-sm text-gray-700">{scopeLabel(r.scope_type, r.scope_id)}</span>,
    },
    {
      key: 'note',
      label: 'Note',
      cell: (r) => <span className="text-sm text-gray-500">{r.note ?? '—'}</span>,
    },
    {
      key: 'id',
      label: 'Actions',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); void handleDecide(r.id, 'approve'); }}
            className="h-7 px-2 text-green-700 border-green-200 hover:bg-green-50"
          >
            Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); void handleDecide(r.id, 'decline'); }}
            className="h-7 px-2 text-red-700 border-red-200 hover:bg-red-50"
          >
            Decline
          </Button>
        </span>
      ),
    },
  ];

  // Sort grants: active first, then by granted_at desc
  const sortedGrants = [...grants].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return (b.granted_at ?? '').localeCompare(a.granted_at ?? '');
  });

  const grantColumns: TableColumn<GrantRow>[] = [
    { key: 'subject', label: 'Subject', sortable: true, searchable: true },
    { key: 'capability', label: 'Capability', sortable: true },
    {
      key: 'scope_type',
      label: 'Scope',
      cell: (g) => <span className="text-sm text-gray-700">{scopeLabel(g.scope_type, g.scope_id)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      cell: (g) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            g.status === 'active'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {g.status}
        </span>
      ),
    },
    {
      key: 'granted_by',
      label: 'Granted by',
      cell: (g) => <span className="text-sm text-gray-500">{g.granted_by ?? '—'}</span>,
    },
    {
      key: 'id',
      label: 'Actions',
      cell: (g) =>
        g.status === 'active' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); void handleRevoke(g.id); }}
            className="h-7 px-2 text-red-700 border-red-200 hover:bg-red-50"
          >
            Revoke
          </Button>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
  ];

  const userColumns: TableColumn<SafeUserRow>[] = [
    { key: 'email_address', label: 'Email', sortable: true, searchable: true },
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      cell: (u) => <span className="text-sm text-gray-700">{u.name ?? '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      cell: (u) => <span className="text-sm text-gray-700">{u.status ?? '—'}</span>,
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      cell: (u) => <span className="text-sm text-gray-500">{fmtDate(u.created_at)}</span>,
    },
  ];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Page heading */}
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Admin</h1>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        {(
          [
            { key: 'pending', label: `Pending requests${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}` },
            { key: 'grants', label: 'Grants' },
            { key: 'users', label: 'Users' },
          ] as { key: Tab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Pending requests */}
      {tab === 'pending' && (
        <div className="rounded-lg border border-gray-200">
          <HazoUiTable<RequestRow>
            columns={requestColumns}
            rows={pendingRequests}
            getRowKey={(r) => r.id}
            enableSearch
            searchPlaceholder="Search requests…"
            empty={
              <EmptyState title="No pending requests" description="All access requests have been handled." />
            }
            mobileCardFallback
          />
        </div>
      )}

      {/* Tab: Grants */}
      {tab === 'grants' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewGrantOpen(true)}
              className="gap-1"
            >
              + New grant
            </Button>
          </div>
          <div className="rounded-lg border border-gray-200">
            <HazoUiTable<GrantRow>
              columns={grantColumns}
              rows={sortedGrants}
              getRowKey={(g) => g.id}
              enableSearch
              searchPlaceholder="Search grants…"
              empty={
                <EmptyState title="No grants" description="Create a grant to give a user a capability." />
              }
              mobileCardFallback
            />
          </div>
        </div>
      )}

      {/* Tab: Users */}
      {tab === 'users' && (
        <div className="rounded-lg border border-gray-200">
          <HazoUiTable<SafeUserRow>
            columns={userColumns}
            rows={users}
            getRowKey={(u) => u.id}
            enableSearch
            searchPlaceholder="Search users…"
            empty={
              <EmptyState title="No users" description="No registered users found." />
            }
            mobileCardFallback
          />
        </div>
      )}

      {/* New grant dialog */}
      <NewGrantDialog
        open={newGrantOpen}
        onOpenChange={setNewGrantOpen}
        onCreated={refresh}
        userEmails={userEmails}
      />
    </div>
  );
}
