'use client';

/**
 * SchedulesScreen
 *
 * Replaces the placeholder Schedules page. Fetches GET /api/schedules (global list,
 * no target filter) and renders four buckets:
 *   - timers    — active one-shot unblock timers (block-now + auto-unblock)
 *   - upcoming  — future one-shot blocks / unblocks not yet fired
 *   - recurring — standalone recurring rows (not part of a window)
 *   - windows   — paired block+unblock cron windows
 *
 * Actions per row:
 *   - Cancel     → DELETE /api/schedules/{id}
 *   - Pause/Resume (recurring only) → PATCH /api/schedules/{id} { enabled: bool }
 *
 * Data fetching: plain fetch in a useEffect, refreshed after mutations — mirrors
 * the rest of the app (no SWR / react-query installed).
 */

import { useState, useEffect, useCallback, useTransition, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  CalendarClock,
  Repeat2,
  Layers,
  Ban,
  ShieldCheck,
  Trash2,
  Pause,
  Play,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  successToast,
  errorToast,
} from 'hazo_ui';

// ---------------------------------------------------------------------------
// Types (mirrors server/schedules/scheduleService.ts — kept local to avoid
// importing server-only code into a client component)
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: string;
  target_type: 'device' | 'group';
  target_id: string;
  action: 'block' | 'unblock';
  run_at: string | null;
  cron: string | null;
  job_id: string;
  status: 'active' | 'paused' | 'done' | 'cancelled';
  created_by: string | null;
  created_at: string;
  label: string | null;
  window_id: string | null;
  next_run_at?: string | null;
}

interface WindowEntry {
  window_id: string;
  label: string | null;
  block: ScheduleRow & { next_run_at?: string | null };
  unblock: ScheduleRow & { next_run_at?: string | null };
}

interface ScheduleList {
  timers: ScheduleRow[];
  upcoming: ScheduleRow[];
  recurring: ScheduleRow[];
  windows: WindowEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function timeUntil(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'now';
    const totalMin = Math.round(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  } catch {
    return '';
  }
}

function targetLabel(row: ScheduleRow): string {
  const kind = row.target_type === 'device' ? 'Device' : 'Group';
  return `${kind}: ${row.target_id.slice(0, 8)}…`;
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: ScheduleRow['status'] }) {
  const map: Record<ScheduleRow['status'], { label: string; cls: string }> = {
    active:    { label: 'Active',    cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
    paused:    { label: 'Paused',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
    done:      { label: 'Done',      cls: 'bg-muted text-muted-foreground'   },
    cancelled: { label: 'Cancelled', cls: 'bg-red-100 text-red-500 dark:bg-red-500/15 dark:text-red-400'     },
  };
  const { label, cls } = map[status] ?? map.active;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------
function SectionHeader({ icon: Icon, title, count }: { icon: typeof Clock; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {count > 0 && (
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduleCard — individual row for timers / upcoming / recurring
// ---------------------------------------------------------------------------
function ScheduleCard({
  row,
  onCancel,
  onTogglePause,
  cancelling,
  toggling,
}: {
  row: ScheduleRow;
  onCancel: (id: string) => void;
  onTogglePause: (id: string, currentStatus: ScheduleRow['status']) => void;
  cancelling: Set<string>;
  toggling: Set<string>;
}) {
  const isRecurring = row.cron != null;
  const actionIcon = row.action === 'block' ? (
    <Ban className="h-3.5 w-3.5 text-red-500" />
  ) : (
    <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
  );

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      {/* Action icon */}
      <span className="mt-0.5 flex-shrink-0">{actionIcon}</span>

      {/* Info */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium text-foreground">
          {row.label ?? (row.action === 'block' ? 'Block' : 'Unblock')}
        </p>
        <p className="text-xs text-muted-foreground">{targetLabel(row)}</p>
        {isRecurring ? (
          <p className="text-xs text-muted-foreground">
            cron: <code className="font-mono">{row.cron}</code>
            {row.next_run_at && (
              <span className="ml-1">&middot; next {formatDateTime(row.next_run_at)}</span>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {row.run_at && (
              <>
                {formatDateTime(row.run_at)}
                <span className="ml-1 text-primary">({timeUntil(row.run_at)})</span>
              </>
            )}
          </p>
        )}
        <StatusBadge status={row.status} />
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 gap-1">
        {isRecurring && row.status !== 'cancelled' && row.status !== 'done' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={toggling.has(row.id)}
            onClick={() => onTogglePause(row.id, row.status)}
            className="h-7 w-7 p-0 text-gray-400 hover:text-amber-600"
            aria-label={row.status === 'paused' ? 'Resume' : 'Pause'}
          >
            {row.status === 'paused' ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {row.status !== 'cancelled' && row.status !== 'done' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancelling.has(row.id)}
            onClick={() => onCancel(row.id)}
            className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
            aria-label="Cancel schedule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WindowCard — pairs a block + unblock cron
// ---------------------------------------------------------------------------
function WindowCard({
  window: win,
  onCancel,
  onTogglePause,
  cancelling,
  toggling,
}: {
  window: WindowEntry;
  onCancel: (id: string) => void;
  onTogglePause: (id: string, currentStatus: ScheduleRow['status']) => void;
  cancelling: Set<string>;
  toggling: Set<string>;
}) {
  const blockRow = win.block;
  const unblockRow = win.unblock;
  const anyActive = blockRow.status === 'active' || unblockRow.status === 'active';
  const anyPaused = blockRow.status === 'paused' || unblockRow.status === 'paused';
  const allCancelled = blockRow.status === 'cancelled' && unblockRow.status === 'cancelled';

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground truncate">
            {win.label ?? 'Block window'}
          </p>
        </div>
        {!allCancelled && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={toggling.has(blockRow.id) || toggling.has(unblockRow.id)}
              onClick={() => {
                // Toggle both sides together
                onTogglePause(blockRow.id, blockRow.status);
                onTogglePause(unblockRow.id, unblockRow.status);
              }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-amber-600"
              aria-label={anyPaused ? 'Resume window' : 'Pause window'}
            >
              {anyPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={cancelling.has(blockRow.id) || cancelling.has(unblockRow.id)}
              onClick={() => {
                onCancel(blockRow.id);
                onCancel(unblockRow.id);
              }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
              aria-label="Cancel window"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Block / Unblock cron rows */}
      <div className="space-y-1 pl-6">
        {[
          { row: blockRow, verb: 'Block' },
          { row: unblockRow, verb: 'Unblock' },
        ].map(({ row, verb }) => (
          <div key={row.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            {verb === 'Block' ? (
              <Ban className="h-3 w-3 text-red-400" />
            ) : (
              <ShieldCheck className="h-3 w-3 text-green-500" />
            )}
            <code className="font-mono">{row.cron}</code>
            {row.next_run_at && (
              <span className="text-muted-foreground">&middot; next {formatDateTime(row.next_run_at)}</span>
            )}
            <StatusBadge status={row.status} />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{targetLabel(blockRow)}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchedulesScreen
// ---------------------------------------------------------------------------
export function SchedulesScreen() {
  const router = useRouter();
  const [, setPending] = useTransition();
  const [data, setData] = useState<ScheduleList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/schedules');
      const json = (await res.json()) as {
        ok: boolean;
        data?: ScheduleList;
        error?: { message: string };
      };
      if (!json.ok) {
        setError(json.error?.message ?? 'Failed to load schedules');
        return;
      }
      setData(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------
  async function handleCancel(id: string) {
    setCancelling((prev) => new Set([...prev, id]));
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Cancel failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: 'Schedule cancelled' });
      void fetchSchedules();
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Cancel failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setCancelling((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  // ---------------------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------------------
  async function handleTogglePause(id: string, currentStatus: ScheduleRow['status']) {
    const enabled = currentStatus === 'paused'; // if paused → enable; if active → disable
    setToggling((prev) => new Set([...prev, id]));
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: enabled ? 'Resume failed' : 'Pause failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      successToast({ title: enabled ? 'Schedule resumed' : 'Schedule paused' });
      void fetchSchedules();
    } catch (e) {
      errorToast({ title: 'Update failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setToggling((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Schedules</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchSchedules()}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Empty overall */}
      {!loading && !error && data && (
        (() => {
          const total =
            data.timers.length +
            data.upcoming.length +
            data.recurring.length +
            data.windows.length;
          if (total === 0) {
            return (
              <EmptyState
                title="No schedules"
                description="Open a device or group and tap 'Set timer / Schedule' to create one."
              />
            );
          }
          return null;
        })()
      )}

      {/* Timers */}
      {(data?.timers.length ?? 0) > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={Clock} title="Active Timers" count={data!.timers.length} />
          {data!.timers.map((row) => (
            <ScheduleCard
              key={row.id}
              row={row}
              onCancel={handleCancel}
              onTogglePause={handleTogglePause}
              cancelling={cancelling}
              toggling={toggling}
            />
          ))}
        </section>
      )}

      {/* Upcoming */}
      {(data?.upcoming.length ?? 0) > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={CalendarClock} title="Upcoming" count={data!.upcoming.length} />
          {data!.upcoming.map((row) => (
            <ScheduleCard
              key={row.id}
              row={row}
              onCancel={handleCancel}
              onTogglePause={handleTogglePause}
              cancelling={cancelling}
              toggling={toggling}
            />
          ))}
        </section>
      )}

      {/* Recurring */}
      {(data?.recurring.length ?? 0) > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={Repeat2} title="Recurring" count={data!.recurring.length} />
          {data!.recurring.map((row) => (
            <ScheduleCard
              key={row.id}
              row={row}
              onCancel={handleCancel}
              onTogglePause={handleTogglePause}
              cancelling={cancelling}
              toggling={toggling}
            />
          ))}
        </section>
      )}

      {/* Windows */}
      {(data?.windows.length ?? 0) > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={Layers} title="Windows" count={data!.windows.length} />
          {data!.windows.map((win) => (
            <WindowCard
              key={win.window_id}
              window={win}
              onCancel={handleCancel}
              onTogglePause={handleTogglePause}
              cancelling={cancelling}
              toggling={toggling}
            />
          ))}
        </section>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      )}

      {/* Helper tip */}
      {!loading && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
          <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            To add a schedule, open a device or group and tap{' '}
            <span className="font-medium text-foreground">Set timer / Schedule</span>.
          </p>
        </div>
      )}
    </div>
  );
}
