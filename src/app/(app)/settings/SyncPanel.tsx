'use client';

import { useState, useEffect, useTransition } from 'react';
import { Button, successToast, errorToast } from 'hazo_ui';

interface SyncStatus {
  last_run_at: string | null;
  status: string | null;
  summary: {
    seen?: number;
    inserted?: number;
    updated?: number;
    went_offline?: number;
    presence_minutes_added?: number;
  } | null;
}

interface SyncPanelProps {
  providerMode: string;
  intervalSec: number;
}

function formatSummary(summary: SyncStatus['summary']): string {
  if (!summary) return 'no data';
  const parts: string[] = [];
  if (summary.seen != null) parts.push(`${summary.seen} seen`);
  if (summary.inserted != null) parts.push(`${summary.inserted} inserted`);
  if (summary.updated != null) parts.push(`${summary.updated} updated`);
  if (summary.went_offline != null) parts.push(`${summary.went_offline} went offline`);
  if (summary.presence_minutes_added != null)
    parts.push(`${summary.presence_minutes_added} presence min`);
  return parts.length > 0 ? parts.join(', ') : 'no data';
}

export function SyncPanel({ providerMode, intervalSec }: SyncPanelProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchStatus = () => {
    fetch('/api/sync/status')
      .then((r) => r.json())
      .then((data) => {
        if (data?.data) setSyncStatus(data.data);
      })
      .catch(() => {
        // best-effort — leave existing state
      });
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleRunSync = () => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/sync/run', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          const msg = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
          errorToast({ title: 'Sync failed', description: msg });
          return;
        }
        const summary = data?.data?.summary;
        successToast({
          title: 'Sync completed',
          description: summary ? formatSummary(summary) : 'Done',
        });
        fetchStatus();
      } catch (err: unknown) {
        errorToast({
          title: 'Sync failed',
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });
  };

  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium text-gray-800">Router &amp; Sync</h2>
        <Button
          size="sm"
          onClick={handleRunSync}
          disabled={isPending}
        >
          {isPending ? 'Running…' : 'Run sync now'}
        </Button>
      </div>
      <dl className="space-y-1 text-sm text-gray-500">
        <div className="flex gap-2">
          <dt className="font-medium text-gray-700">Provider:</dt>
          <dd>{providerMode}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-gray-700">Interval:</dt>
          <dd>{intervalSec}s</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-gray-700">Last run:</dt>
          <dd>
            {syncStatus?.last_run_at
              ? new Date(syncStatus.last_run_at).toLocaleString()
              : 'never'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-gray-700">Last status:</dt>
          <dd>{syncStatus?.status ?? '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-gray-700">Last summary:</dt>
          <dd>{syncStatus ? formatSummary(syncStatus.summary) : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
