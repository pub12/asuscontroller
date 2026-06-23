'use client';
import { useEffect, useRef, useState } from 'react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // index = weekday 0..6

type Rule = { weekday: number; time_min: number; action: 'block' | 'unblock' };
type Window = { id: string; days: boolean[]; startMin: number; endMin: number };

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmt12 = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
};

let _uid = 0;
const uid = () => `w${++_uid}`;

function opposite(a: 'block' | 'unblock'): 'block' | 'unblock' {
  return a === 'block' ? 'unblock' : 'block';
}

function rulesToWindows(rules: Rule[], defaultAction: 'block' | 'unblock'): Window[] {
  // Walk every transition in weekly chronological order, pairing each "enter"
  // (action !== defaultAction) with the next "exit" (action === defaultAction).
  // A state machine pairs correctly across the day boundary (overnight windows)
  // and won't mis-consume an unrelated window's exit the way per-day matching can.
  const sorted = [...rules].sort((a, b) => a.weekday - b.weekday || a.time_min - b.time_min);

  type Span = { startMin: number; endMin: number; weekday: number };
  const spans: Span[] = [];
  let open: Rule | null = null;
  for (const r of sorted) {
    if (r.action !== defaultAction) {
      if (!open) open = r; // ignore redundant enters while already inside a window
    } else if (open) {
      spans.push({ startMin: open.time_min, endMin: r.time_min, weekday: open.weekday });
      open = null;
    }
  }
  // A window opened late in the week wraps to the first exit at the week's start.
  if (open) {
    const firstExit = sorted.find(r => r.action === defaultAction);
    if (firstExit) spans.push({ startMin: open.time_min, endMin: firstExit.time_min, weekday: open.weekday });
  }

  // Group identical startMin|endMin across weekdays
  const groups = new Map<string, Window>();
  for (const s of spans) {
    const key = `${s.startMin}|${s.endMin}`;
    let g = groups.get(key);
    if (!g) {
      g = { id: uid(), days: [false, false, false, false, false, false, false], startMin: s.startMin, endMin: s.endMin };
      groups.set(key, g);
    }
    g.days[s.weekday] = true;
  }

  return [...groups.values()].sort((a, b) => a.startMin - b.startMin);
}

function windowsToRules(windows: Window[], defaultAction: 'block' | 'unblock'): Rule[] {
  const out: Rule[] = [];
  for (const w of windows) {
    w.days.forEach((on, wd) => {
      if (!on) return;
      if (w.endMin > w.startMin) {
        // Normal window
        out.push({ weekday: wd, time_min: w.startMin, action: opposite(defaultAction) });
        out.push({ weekday: wd, time_min: w.endMin, action: defaultAction });
      } else {
        // Overnight window
        out.push({ weekday: wd, time_min: w.startMin, action: opposite(defaultAction) });
        out.push({ weekday: (wd + 1) % 7, time_min: w.endMin, action: defaultAction });
      }
    });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.time_min - b.time_min);
}

function mergeWindowsForDay(wins: Window[], dayIdx: number): { merged: Window[]; count: number } {
  const relevant = wins.filter(w => w.days[dayIdx]).sort((a, b) => a.startMin - b.startMin);
  if (relevant.length === 0) return { merged: [], count: 0 };
  const groups: Window[] = [{ ...relevant[0], days: [...relevant[0].days] }];
  let mergeCount = 0;
  for (let i = 1; i < relevant.length; i++) {
    const last = groups[groups.length - 1];
    const cur = relevant[i];
    if (cur.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, cur.endMin);
      mergeCount++;
    } else {
      groups.push({ ...cur, days: [...cur.days] });
    }
  }
  return { merged: groups, count: mergeCount };
}

function pixelToMin(offsetX: number, trackWidth: number): number {
  return Math.round((offsetX / trackWidth) * 1440 / 15) * 15;
}

function getMelbourneNow(): { weekday: number; minuteOfDay: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const dayStr = parts.find(p => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const min = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { weekday: dayMap[dayStr] ?? 0, minuteOfDay: hour * 60 + min };
}

export function SchedulePolicyEditor({ targetType, targetId }: { targetType: 'device' | 'group'; targetId: string }) {
  const [defaultAction, setDefaultAction] = useState<'block' | 'unblock'>('unblock');
  const [windows, setWindows] = useState<Window[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [current, setCurrent] = useState<string | null>(null);
  const [nextISO, setNextISO] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'warn'; msg: string } | null>(null);
  const [mergeWarning, setMergeWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Quick-add state
  const [qaStart, setQaStart] = useState('16:00');
  const [qaEnd, setQaEnd] = useState('18:00');
  const [qaDays, setQaDays] = useState<boolean[]>([true, true, true, true, true, false, false]);

  // Drag/resize/move state using refs so event handlers always see current values
  type DragState = { dayIndex: number; startMin: number; trackWidth: number } | null;
  type ResizeState = { windowId: string; edge: 'start' | 'end'; dayIndex: number; trackWidth: number } | null;
  type MoveState = { windowId: string; dayIndex: number; origStartMin: number; origEndMin: number; clickMin: number; trackWidth: number } | null;
  type DraggingPreview = { dayIndex: number; startMin: number; endMin: number } | null;

  const dragState = useRef<DragState>(null);
  const resizeState = useRef<ResizeState>(null);
  const moveState = useRef<MoveState>(null);
  const [dragging, setDragging] = useState<DraggingPreview>(null);

  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);

  // "Now" marker — null until mounted (so SSR and the first client render agree),
  // then refreshed every minute so the marker doesn't drift as the page stays open.
  const [melbNow, setMelbNow] = useState<{ weekday: number; minuteOfDay: number } | null>(null);
  useEffect(() => {
    setMelbNow(getMelbourneNow());
    const id = setInterval(() => setMelbNow(getMelbourneNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Load policy
  useEffect(() => {
    fetch(`/api/schedules/policies?targetType=${targetType}&targetId=${targetId}`)
      .then(r => r.json())
      .then(res => {
        const p = res?.data?.policy;
        if (p) {
          const da: 'block' | 'unblock' = p.default_action === 'block' ? 'block' : 'unblock';
          setDefaultAction(da);
          setWindows(rulesToWindows(p.rules ?? [], da));
          setEnabled(!!p.enabled);
        }
        setCurrent(res?.data?.currentState ?? null);
        setNextISO(res?.data?.nextTransitionISO ?? null);
      })
      .catch(() => {});
  }, [targetType, targetId]);

  // Global mouse event listeners for drag/resize/move
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Handle new-window drag
      if (dragState.current) {
        const { dayIndex, startMin, trackWidth } = dragState.current;
        const trackEl = trackRefs.current[dayIndex];
        if (!trackEl) return;
        const rect = trackEl.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const currentMin = Math.min(1440, Math.max(0, pixelToMin(offsetX, trackWidth)));
        setDragging({ dayIndex, startMin, endMin: currentMin });
        return;
      }
      // Handle resize
      if (resizeState.current) {
        const { windowId, edge, trackWidth, dayIndex } = resizeState.current;
        const trackEl = trackRefs.current[dayIndex];
        if (!trackEl) return;
        const rect = trackEl.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const newMin = Math.min(1440, Math.max(0, pixelToMin(offsetX, trackWidth)));
        setWindows(prev => prev.map(w => {
          if (w.id !== windowId) return w;
          if (edge === 'start') {
            const newStart = Math.min(newMin, w.endMin - 15);
            return { ...w, startMin: newStart };
          } else {
            const newEnd = Math.max(newMin, w.startMin + 15);
            return { ...w, endMin: newEnd };
          }
        }));
        return;
      }
      // Handle move
      if (moveState.current) {
        const { windowId, origStartMin, origEndMin, clickMin, trackWidth, dayIndex } = moveState.current;
        const trackEl = trackRefs.current[dayIndex];
        if (!trackEl) return;
        const rect = trackEl.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const currentMin = Math.min(1440, Math.max(0, pixelToMin(offsetX, trackWidth)));
        const delta = currentMin - clickMin;
        const duration = origEndMin - origStartMin;
        const newStart = Math.min(1440 - duration, Math.max(0, origStartMin + delta));
        const newEnd = newStart + duration;
        setWindows(prev => prev.map(w => {
          if (w.id !== windowId) return w;
          return { ...w, startMin: newStart, endMin: newEnd };
        }));
        return;
      }
    };

    const onUp = (e: MouseEvent) => {
      // Commit drag
      if (dragState.current) {
        const { dayIndex, startMin, trackWidth } = dragState.current;
        dragState.current = null;
        const trackEl = trackRefs.current[dayIndex];
        if (trackEl) {
          const rect = trackEl.getBoundingClientRect();
          const offsetX = e.clientX - rect.left;
          const endMin = Math.min(1440, Math.max(0, pixelToMin(offsetX, trackWidth)));
          const lo = Math.min(startMin, endMin);
          const hi = Math.max(startMin, endMin);
          if (hi - lo >= 15) {
            const days: boolean[] = [false, false, false, false, false, false, false];
            days[dayIndex] = true;
            setWindows(prev => [...prev, { id: uid(), days, startMin: lo, endMin: hi }]);
          }
        }
        setDragging(null);
        return;
      }
      // Commit resize/move — already applied live
      resizeState.current = null;
      moveState.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // Handlers read only refs and the functional setWindows(prev => …) form, so
    // they never close over stale `windows`/`defaultAction` — register once and
    // avoid tearing the listeners down on every window edit.
  }, []);

  function handleTrackMouseDown(e: React.MouseEvent<HTMLDivElement>, dayIndex: number) {
    if (e.button !== 0) return;
    const trackEl = trackRefs.current[dayIndex];
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;
    const offsetX = e.clientX - rect.left;
    const startMin = Math.min(1440, Math.max(0, pixelToMin(offsetX, trackWidth)));
    dragState.current = { dayIndex, startMin, trackWidth };
    setDragging({ dayIndex, startMin, endMin: startMin });
  }

  function handleWindowMouseDown(e: React.MouseEvent<HTMLDivElement>, windowId: string, dayIndex: number) {
    if (e.button !== 0) return;
    setSelected(windowId);
    const trackEl = trackRefs.current[dayIndex];
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const trackWidth = rect.width;
    const offsetX = e.clientX - rect.left;
    const clickMin = pixelToMin(offsetX, trackWidth);
    const w = windows.find(win => win.id === windowId);
    if (!w) return;
    moveState.current = {
      windowId, dayIndex,
      origStartMin: w.startMin, origEndMin: w.endMin,
      clickMin, trackWidth,
    };
  }

  function handleResizeMouseDown(e: React.MouseEvent<HTMLDivElement>, windowId: string, edge: 'start' | 'end', dayIndex: number) {
    if (e.button !== 0) return;
    const trackEl = trackRefs.current[dayIndex];
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    resizeState.current = { windowId, edge, dayIndex, trackWidth: rect.width };
  }

  function removeWindow(id: string) {
    setWindows(prev => prev.filter(w => w.id !== id));
    if (selected === id) setSelected(null);
  }

  function toggleQaDay(i: number) {
    setQaDays(prev => prev.map((v, j) => j === i ? !v : v));
  }

  function addQaWindow() {
    const startMin = toMin(qaStart);
    const endMin = toMin(qaEnd);
    if (startMin === endMin) {
      setStatus({ kind: 'error', msg: 'Window start and end can’t be the same time.' });
      return;
    }
    const days: boolean[] = [...qaDays];
    if (!days.some(Boolean)) return;
    setStatus(null);
    setWindows(prev => [...prev, { id: uid(), days, startMin, endMin }]);
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    setMergeWarning(null);

    try {
      // Run overlap merge per day
      let mergedWindows = [...windows];
      let totalMerged = 0;
      let daysMerged: string[] = [];

      // Build a map: key = `startMin|endMin` -> Window (rebuilding after per-day merges)
      const perDayMerged: Map<number, Window[]> = new Map();
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const { merged, count } = mergeWindowsForDay(mergedWindows, dayIdx);
        if (count > 0) {
          totalMerged += count;
          daysMerged.push(DAYS[dayIdx]);
        }
        perDayMerged.set(dayIdx, merged);
      }

      if (totalMerged > 0) {
        // Rebuild windows from the per-day merge results
        const rebuilt = new Map<string, Window>();
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
          const dayWins = perDayMerged.get(dayIdx) ?? [];
          for (const w of dayWins) {
            const key = `${w.startMin}|${w.endMin}`;
            let existing = rebuilt.get(key);
            if (!existing) {
              existing = { id: uid(), days: [false, false, false, false, false, false, false], startMin: w.startMin, endMin: w.endMin };
              rebuilt.set(key, existing);
            }
            existing.days[dayIdx] = true;
          }
        }
        // perDayMerged covers all 7 days (merged or not), so `rebuilt` is the
        // complete window set — no separate pass for unmerged days is needed.

        mergedWindows = [...rebuilt.values()];
        const warning = `${totalMerged} overlapping window(s) on ${daysMerged.join(', ')} were merged.`;
        setMergeWarning(warning);
        setWindows(mergedWindows);
        setStatus({ kind: 'warn', msg: warning });
      }

      const rules = windowsToRules(mergedWindows, defaultAction);

      const res = await fetch('/api/schedules/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, enabled, defaultAction, rules }),
      }).then(r => r.json());

      if (!res?.ok) {
        setStatus({ kind: 'error', msg: res?.error?.message ?? 'Save failed.' });
        return;
      }

      // Re-GET to refresh current/nextISO
      const g = await fetch(`/api/schedules/policies?targetType=${targetType}&targetId=${targetId}`).then(r => r.json());
      setCurrent(g?.data?.currentState ?? null);
      setNextISO(g?.data?.nextTransitionISO ?? null);

      if (totalMerged === 0) {
        setStatus({ kind: 'ok', msg: 'Schedule saved.' });
      }
    } catch {
      setStatus({ kind: 'error', msg: 'Save failed — check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  }

  const defaultFillClass = defaultAction === 'block'
    ? 'bg-destructive/20 border border-destructive/30'
    : 'bg-emerald-500/10 border border-emerald-500/20';

  const exceptionClass = defaultAction === 'block'
    ? 'bg-emerald-500/30 border border-emerald-500/50'
    : 'bg-destructive/30 border border-destructive/50';

  const exceptionLabel = defaultAction === 'block' ? 'Allow' : 'Block';
  const exceptionPillClass = defaultAction === 'block'
    ? 'bg-emerald-500/15 text-emerald-600'
    : 'bg-destructive/15 text-destructive';

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card/40 p-5">
      {/* 1. Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold leading-none">Recurring schedule</h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            All times in <strong className="font-medium text-foreground/80">Melbourne</strong> (AEST/AEDT).
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
          Enabled
        </label>
      </div>

      {/* 2. Now/Next readout */}
      {(current || nextISO) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {current && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${current === 'block' ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-500'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${current === 'block' ? 'bg-destructive' : 'bg-emerald-500'}`} />
              Now: {current === 'block' ? 'Blocked' : 'Allowed'}
            </span>
          )}
          {nextISO && (
            <span className="text-muted-foreground">
              Next change {new Date(nextISO).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* 3. Default-action segmented control */}
      <div>
        <div className="flex rounded-lg border border-input overflow-hidden text-sm font-medium">
          <button
            type="button"
            onClick={() => setDefaultAction('block')}
            className={`flex-1 py-2 transition-colors ${defaultAction === 'block' ? 'bg-destructive text-destructive-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Blocked by default
          </button>
          <button
            type="button"
            onClick={() => setDefaultAction('unblock')}
            className={`flex-1 py-2 transition-colors ${defaultAction === 'unblock' ? 'bg-emerald-500 text-white' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Allowed by default
          </button>
        </div>
        {windows.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            These {windows.length} window(s) now {defaultAction === 'block' ? 'allow' : 'block'} instead.
          </p>
        )}
      </div>

      {/* 4. Weekly visual timeline */}
      <div className="space-y-0.5">
        {/* Hour labels */}
        <div className="flex items-center gap-2 mb-0.5">
          <span className="w-8 shrink-0" />
          <div className="relative flex-1 text-xs text-muted-foreground">
            <span className="absolute" style={{ left: '0%' }}>0h</span>
            <span className="absolute -translate-x-1/2" style={{ left: '25%' }}>6h</span>
            <span className="absolute -translate-x-1/2" style={{ left: '50%' }}>12h</span>
            <span className="absolute -translate-x-1/2" style={{ left: '75%' }}>18h</span>
            <span className="absolute -translate-x-full" style={{ left: '100%' }}>24h</span>
          </div>
        </div>

        {DAYS.map((dayLabel, dayIndex) => (
          <div className="flex items-center gap-2 my-1" key={dayIndex}>
            <span className="w-8 text-xs text-muted-foreground text-right shrink-0">{dayLabel}</span>
            <div
              ref={(el) => { trackRefs.current[dayIndex] = el; }}
              className="relative h-7 flex-1 rounded overflow-hidden cursor-crosshair select-none"
              onMouseDown={(e) => handleTrackMouseDown(e, dayIndex)}
            >
              {/* Default fill */}
              <div className={`absolute inset-0 ${defaultFillClass}`} />

              {/* Gridlines */}
              {[6 * 60, 12 * 60, 18 * 60].map(gMin => (
                <div
                  key={gMin}
                  className="absolute top-0 h-full border-l border-border/30 pointer-events-none"
                  style={{ left: `${(gMin / 1440) * 100}%` }}
                />
              ))}

              {/* Exception windows (skip overnight for visual) */}
              {windows
                .filter(w => w.days[dayIndex] && w.endMin > w.startMin)
                .map(w => {
                  const isSelected = selected === w.id;
                  return (
                    <div
                      key={w.id}
                      className={`absolute top-0 h-full cursor-pointer ${exceptionClass} ${isSelected ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{
                        left: `${(w.startMin / 1440) * 100}%`,
                        width: `${((w.endMin - w.startMin) / 1440) * 100}%`,
                      }}
                      onMouseDown={(e) => { e.stopPropagation(); handleWindowMouseDown(e, w.id, dayIndex); }}
                    >
                      {/* Left resize handle */}
                      <div
                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
                        onMouseDown={(e) => { e.stopPropagation(); handleResizeMouseDown(e, w.id, 'start', dayIndex); }}
                      />
                      {/* Right resize handle */}
                      <div
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                        onMouseDown={(e) => { e.stopPropagation(); handleResizeMouseDown(e, w.id, 'end', dayIndex); }}
                      />
                    </div>
                  );
                })}

              {/* Drag preview */}
              {dragging?.dayIndex === dayIndex && (
                <div
                  className={`absolute top-0 h-full opacity-60 ${exceptionClass}`}
                  style={{
                    left: `${(Math.min(dragging.startMin, dragging.endMin) / 1440) * 100}%`,
                    width: `${(Math.abs(dragging.endMin - dragging.startMin) / 1440) * 100}%`,
                  }}
                />
              )}

              {/* Now marker */}
              {melbNow && melbNow.weekday === dayIndex && (
                <div
                  className="absolute top-0 h-full border-l-2 border-dashed border-primary/70 pointer-events-none z-10"
                  style={{ left: `${(melbNow.minuteOfDay / 1440) * 100}%` }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 5. Exceptions list + quick-add */}
      <div className="space-y-2">
        {windows.length > 0 && (
          <div className="space-y-1">
            {windows.map(w => {
              const activeDays = DAYS.filter((_, i) => w.days[i]);
              return (
                <div key={w.id} className="flex flex-wrap items-center gap-2 text-sm py-1">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${exceptionPillClass}`}>
                    {exceptionLabel}
                  </span>
                  <span className="tabular-nums text-foreground/80">
                    {toHHMM(w.startMin)} – {toHHMM(w.endMin)}
                  </span>
                  {w.endMin <= w.startMin && (
                    <span className="text-xs text-muted-foreground">(overnight)</span>
                  )}
                  <div className="flex gap-1 flex-wrap">
                    {activeDays.map(d => (
                      <span key={d} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{d}</span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWindow(w.id)}
                    className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick-add form */}
        <div className="flex flex-wrap items-center gap-2 text-sm border border-dashed border-border/60 rounded-lg p-3">
          <input
            type="time"
            value={qaStart}
            onChange={e => setQaStart(e.target.value)}
            className="rounded-md border border-input bg-background px-2.5 py-1.5 tabular-nums text-sm"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="time"
            value={qaEnd}
            onChange={e => setQaEnd(e.target.value)}
            className="rounded-md border border-input bg-background px-2.5 py-1.5 tabular-nums text-sm"
          />
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleQaDay(i)}
                className={`h-7 w-9 rounded text-xs font-semibold ${qaDays[i] ? 'bg-primary text-primary-foreground' : 'border border-input text-muted-foreground'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={addQaWindow}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            + Add
          </button>
        </div>
      </div>

      {/* 6. Merge warning */}
      {mergeWarning && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 text-sm text-amber-600">
          {mergeWarning}
        </div>
      )}

      {/* 7. Save button + status */}
      <div className="flex items-center gap-3 border-t border-border/50 pt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
        {status && (
          <span className={`text-sm font-medium ${status.kind === 'ok' ? 'text-emerald-500' : status.kind === 'warn' ? 'text-amber-500' : 'text-destructive'}`}>
            {status.msg}
          </span>
        )}
        {selected && (
          <button
            type="button"
            onClick={() => removeWindow(selected)}
            className="ml-auto rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground border border-input transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            Remove selected window
          </button>
        )}
      </div>
    </div>
  );
}
