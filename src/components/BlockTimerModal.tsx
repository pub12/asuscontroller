'use client';

/**
 * BlockTimerModal
 *
 * A modal that lets users set up scheduled access control for a device or group.
 * Supports three scheduling modes (mirroring the design in screen copy 2.png):
 *
 *   1. Auto-unblock timer — blocks NOW, auto-unblocks after a duration or at a
 *      specific time. Quick picks: 15m / 30m / 1h / 2h / Custom.
 *      "Until a specific time" toggle reveals an HH:MM input.
 *
 *   2. Future block — schedule a one-shot block or unblock at a future date+time
 *      (no immediate action).
 *
 *   3. Recurring schedule — repeating block / unblock on a cron-based schedule.
 *      Simple UI: day-of-week checkboxes + START / END times (creates a window),
 *      or a raw cron field + action for advanced users.
 *
 * API shape consumed (POST /api/schedules):
 *   kind: 'timer'     → { targetType, targetId, durationMin? | untilISO?, label? }
 *   kind: 'future'    → { targetType, targetId, action, atISO, label? }
 *   kind: 'recurring' → { targetType, targetId, action, cron, label? }
 *   kind: 'window'    → { targetType, targetId, blockCron, unblockCron, label? }
 *
 * Response: { ok: true, data: { schedule } } | { ok: false, error: { message } }
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import {
  Lock,
  Clock,
  CalendarClock,
  Repeat2,
} from 'lucide-react';
import { Button, HazoUiDialog, successToast, errorToast } from 'hazo_ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockTimerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'device' | 'group';
  targetId: string;
  targetLabel: string;
  /** If false the device/group is currently unblocked — affects timer tab copy. */
  isBlocked?: boolean;
}

type Tab = 'timer' | 'future' | 'recurring';

// Duration quick-pick options (minutes)
const DURATION_PRESETS = [
  { label: '15m', min: 15 },
  { label: '30m', min: 30 },
  { label: '1h', min: 60 },
  { label: '2h', min: 120 },
] as const;

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const DAY_FULL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 5-field cron from days mask + HH:MM. */
function buildCron(hour: number, minute: number, daysMask: boolean[]): string {
  const dow = daysMask
    .map((on, i) => (on ? i : null))
    .filter((i): i is number => i !== null)
    .join(',');
  const dowField = dow === '' ? '*' : dow;
  return `${minute} ${hour} * * ${dowField}`;
}

/** HH:MM → { hour, minute } */
function parseTime(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

/** "today at HH:MM" as ISO string. Used for untilISO timer mode. */
function todayAtHHMM(hhmm: string): string {
  const { hour, minute } = parseTime(hhmm);
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  // If the time has already passed today, use tomorrow.
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Build a datetime-local value for <input type="datetime-local"> from an ISO string. */
function toDatetimeLocal(iso: string): string {
  // datetime-local format: "YYYY-MM-DDTHH:MM"
  return iso.slice(0, 16);
}

/** Get a reasonable default for datetime-local: 1 hour from now. */
function defaultFutureISO(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return toDatetimeLocal(d.toISOString());
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function TimerPanel({
  onSubmit,
  submitting,
}: {
  onSubmit: (body: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const [selectedPreset, setSelectedPreset] = useState<number | 'custom' | 'until'>('custom');
  const [customMin, setCustomMin] = useState('60');
  const [untilEnabled, setUntilEnabled] = useState(false);
  const [untilTime, setUntilTime] = useState('22:00');

  function handleSubmit() {
    if (untilEnabled) {
      onSubmit({ kind: 'timer', untilISO: todayAtHHMM(untilTime) });
      return;
    }
    if (selectedPreset === 'custom') {
      const mins = parseInt(customMin, 10);
      if (!mins || mins <= 0) {
        errorToast({ title: 'Invalid duration', description: 'Enter a positive number of minutes.' });
        return;
      }
      onSubmit({ kind: 'timer', durationMin: mins });
    } else if (typeof selectedPreset === 'number') {
      onSubmit({ kind: 'timer', durationMin: selectedPreset });
    }
  }

  return (
    <div className="space-y-5">
      {/* Description */}
      <p className="text-sm text-gray-500">
        Blocks internet now and auto-unblocks after the selected duration.
      </p>

      {/* Quick picks */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Quick pick</p>
        <div className="flex flex-wrap gap-2">
          {DURATION_PRESETS.map(({ label, min }) => (
            <button
              key={min}
              type="button"
              disabled={untilEnabled}
              onClick={() => { setSelectedPreset(min); }}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                !untilEnabled && selectedPreset === min
                  ? 'border-teal-700 bg-teal-700 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-teal-600 hover:text-teal-700'
              }`}
            >
              {label}
            </button>
          ))}
          {/* Custom */}
          <button
            type="button"
            disabled={untilEnabled}
            onClick={() => setSelectedPreset('custom')}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
              !untilEnabled && selectedPreset === 'custom'
                ? 'border-teal-700 bg-teal-700 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-teal-600 hover:text-teal-700'
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {/* Custom duration input */}
      {!untilEnabled && selectedPreset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
            className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          <span className="text-sm text-gray-500">minutes</span>
        </div>
      )}

      {/* Until specific time */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-teal-700" />
            <span className="text-sm font-medium text-gray-800">Until a specific time</span>
          </div>
          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={untilEnabled}
            onClick={() => setUntilEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 ${
              untilEnabled ? 'bg-teal-700' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                untilEnabled ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {untilEnabled && (
          <input
            type="time"
            value={untilTime}
            onChange={(e) => setUntilTime(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        )}
      </div>

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-teal-700 text-white hover:bg-teal-800 py-3 rounded-xl text-base font-semibold"
      >
        <Lock className="mr-2 h-4 w-4" />
        {submitting ? 'Blocking…' : 'Block now'}
      </Button>
    </div>
  );
}

function FuturePanel({
  onSubmit,
  submitting,
}: {
  onSubmit: (body: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const [action, setAction] = useState<'block' | 'unblock'>('block');
  const [atLocal, setAtLocal] = useState(defaultFutureISO);

  function handleSubmit() {
    if (!atLocal) {
      errorToast({ title: 'Select a date & time' });
      return;
    }
    const atISO = new Date(atLocal).toISOString();
    if (new Date(atISO) <= new Date()) {
      errorToast({ title: 'Choose a future date & time' });
      return;
    }
    onSubmit({ kind: 'future', action, atISO });
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Schedule a one-time block or unblock for a future date and time.
      </p>

      {/* Action picker */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Action</p>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          {(['block', 'unblock'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                action === a
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Date + time */}
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
          Date &amp; Time
        </label>
        <input
          type="datetime-local"
          value={atLocal}
          onChange={(e) => setAtLocal(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-teal-700 text-white hover:bg-teal-800 py-3 rounded-xl text-base font-semibold"
      >
        <CalendarClock className="mr-2 h-4 w-4" />
        {submitting ? 'Scheduling…' : `Schedule ${action}`}
      </Button>
    </div>
  );
}

function RecurringPanel({
  onSubmit,
  submitting,
}: {
  onSubmit: (body: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  // Window mode: pick days + start/end times → creates block+unblock cron pair
  const [windowEnabled, setWindowEnabled] = useState(true);
  const [daysMask, setDaysMask] = useState<boolean[]>([false, true, true, true, true, true, false]);
  const [startTime, setStartTime] = useState('20:00');
  const [endTime, setEndTime] = useState('07:00');

  // Advanced / standalone cron mode
  const [advAction, setAdvAction] = useState<'block' | 'unblock'>('block');
  const [cronExpr, setCronExpr] = useState('0 22 * * 1-5');

  function toggleDay(idx: number) {
    setDaysMask((prev) => {
      const next = [...prev];
      next[idx] = !next[idx]!;
      return next;
    });
  }

  function handleSubmit() {
    if (windowEnabled) {
      const noDay = daysMask.every((d) => !d);
      if (noDay) {
        errorToast({ title: 'Select at least one day' });
        return;
      }
      const { hour: bh, minute: bm } = parseTime(startTime);
      const { hour: uh, minute: um } = parseTime(endTime);
      const blockCron = buildCron(bh, bm, daysMask);
      const unblockCron = buildCron(uh, um, daysMask);
      onSubmit({ kind: 'window', blockCron, unblockCron });
    } else {
      const cron = cronExpr.trim();
      const parts = cron.split(/\s+/);
      if (parts.length !== 5) {
        errorToast({ title: 'Invalid cron', description: 'Enter a 5-field cron expression (e.g. 0 22 * * 1-5).' });
        return;
      }
      onSubmit({ kind: 'recurring', action: advAction, cron });
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Set up a repeating block window or standalone recurring action.
      </p>

      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat2 className="h-4 w-4 text-teal-700" />
          <span className="text-sm font-medium text-gray-800">Block window (start + end)</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={windowEnabled}
          onClick={() => setWindowEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 ${
            windowEnabled ? 'bg-teal-700' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              windowEnabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {windowEnabled ? (
        <>
          {/* Day of week picker */}
          <div>
            <div className="flex justify-center gap-2">
              {DAYS.map((d, i) => (
                <button
                  key={`${d}-${i}`}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    daysMask[i]
                      ? 'bg-teal-700 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                  aria-label={DAY_FULL[i]}
                  aria-pressed={daysMask[i]}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Start / End times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Start (block)</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">End (unblock)</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Advanced: action + raw cron */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Action</p>
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              {(['block', 'unblock'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAdvAction(a)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors ${
                    advAction === a
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Cron expression (5-field)</label>
            <input
              type="text"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 22 * * 1-5"
              className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
            <p className="mt-1 text-xs text-gray-400">e.g. <code>0 22 * * 1-5</code> = weeknights at 10 PM</p>
          </div>
        </>
      )}

      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-teal-700 text-white hover:bg-teal-800 py-3 rounded-xl text-base font-semibold"
      >
        <Repeat2 className="mr-2 h-4 w-4" />
        {submitting ? 'Saving…' : 'Save schedule'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BlockTimerModal
// ---------------------------------------------------------------------------

const TABS: { id: Tab; label: string; Icon: typeof Clock }[] = [
  { id: 'timer', label: 'Timer', Icon: Clock },
  { id: 'future', label: 'Future', Icon: CalendarClock },
  { id: 'recurring', label: 'Recurring', Icon: Repeat2 },
];

export function BlockTimerModal({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
}: BlockTimerModalProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('timer');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(extra: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const body = { targetType, targetId, ...extra };
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        errorToast({ title: 'Schedule failed', description: json.error?.message ?? 'Unknown error' });
        return;
      }
      const kindLabel =
        extra.kind === 'timer'
          ? 'Timer set'
          : extra.kind === 'future'
          ? 'Scheduled'
          : 'Recurring schedule saved';
      successToast({ title: kindLabel, description: `Applied to ${targetLabel}` });
      onOpenChange(false);
      startTransition(() => { router.refresh(); });
    } catch (e) {
      errorToast({ title: 'Schedule failed', description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <HazoUiDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Set timer / Schedule"
      sizeWidth="480px"
      showCloseButton
      // We render our own footer buttons inside each panel
      actionButtonText=""
      onConfirm={() => { /* no-op — panels handle submit */ }}
    >
      <div className="space-y-4 p-4 pt-2">
        {/* Target label */}
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-700">{targetLabel}</span>{' '}
          &middot;{' '}
          {targetType === 'device' ? 'device' : 'group'}
        </p>

        {/* Tab strip */}
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Panel */}
        {tab === 'timer' && (
          <TimerPanel onSubmit={handleSubmit} submitting={submitting} />
        )}
        {tab === 'future' && (
          <FuturePanel onSubmit={handleSubmit} submitting={submitting} />
        )}
        {tab === 'recurring' && (
          <RecurringPanel onSubmit={handleSubmit} submitting={submitting} />
        )}
      </div>
    </HazoUiDialog>
  );
}
