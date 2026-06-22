'use client';
import { useEffect, useState } from 'react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // index = weekday 0..6
type Rule = { weekday: number; time_min: number; action: 'block' | 'unblock' };
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function SchedulePolicyEditor({ targetType, targetId }: { targetType: 'device' | 'group'; targetId: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [current, setCurrent] = useState<string | null>(null);
  const [nextISO, setNextISO] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Quick-add state
  const [qaKind, setQaKind] = useState<'allow' | 'block'>('allow');
  const [qaStart, setQaStart] = useState('16:00');
  const [qaEnd, setQaEnd] = useState('18:00');
  const [qaDays, setQaDays] = useState<boolean[]>([true, true, true, true, true, false, false]);

  useEffect(() => {
    fetch(`/api/schedules/policies?targetType=${targetType}&targetId=${targetId}`)
      .then((r) => r.json())
      .then((res) => {
        const p = res?.data?.policy;
        if (p) { setRules(p.rules ?? []); setEnabled(!!p.enabled); }
        setCurrent(res?.data?.currentState ?? null);
        setNextISO(res?.data?.nextTransitionISO ?? null);
      })
      .catch(() => {});
  }, [targetType, targetId]);

  function addQuickAdd() {
    // allow: blocked baseline, unblock@start + block@end. block: inverse.
    const startAction = qaKind === 'allow' ? 'unblock' : 'block';
    const endAction = qaKind === 'allow' ? 'block' : 'unblock';
    const added: Rule[] = [];
    qaDays.forEach((on, wd) => {
      if (!on) return;
      added.push({ weekday: wd, time_min: toMin(qaStart), action: startAction });
      added.push({ weekday: wd, time_min: toMin(qaEnd), action: endAction });
    });
    setRules((prev) => [...prev, ...added].sort((a, b) => a.weekday - b.weekday || a.time_min - b.time_min));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/schedules/policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, enabled, rules }),
      }).then((r) => r.json());
      const p = res?.data?.policy;
      if (p) setRules(p.rules ?? []);
      // Refresh computed state.
      const g = await fetch(`/api/schedules/policies?targetType=${targetType}&targetId=${targetId}`).then((r) => r.json());
      setCurrent(g?.data?.currentState ?? null);
      setNextISO(g?.data?.nextTransitionISO ?? null);
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Recurring schedule</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>

      <p className="text-sm text-muted-foreground">
        All times in <strong>Melbourne</strong> (AEST/AEDT).
        {current && <> Now: <strong>{current === 'block' ? 'blocked' : 'allowed'}</strong>.</>}
        {nextISO && <> Next change: {new Date(nextISO).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}.</>}
      </p>

      {/* Quick add */}
      <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-3 text-sm">
        <select value={qaKind} onChange={(e) => setQaKind(e.target.value as 'allow' | 'block')} className="rounded border px-2 py-1">
          <option value="allow">Allow window (blocked all day, allow…)</option>
          <option value="block">Block window (allowed all day, block…)</option>
        </select>
        <input type="time" value={qaStart} onChange={(e) => setQaStart(e.target.value)} className="rounded border px-2 py-1" />
        <span>to</span>
        <input type="time" value={qaEnd} onChange={(e) => setQaEnd(e.target.value)} className="rounded border px-2 py-1" />
        <div className="flex gap-1">
          {DAYS.map((d, i) => (
            <button key={d} type="button"
              onClick={() => setQaDays((p) => p.map((v, j) => (j === i ? !v : v)))}
              className={`h-7 w-9 rounded text-xs ${qaDays[i] ? 'bg-primary text-primary-foreground' : 'bg-background border'}`}>{d}</button>
          ))}
        </div>
        <button type="button" onClick={addQuickAdd} className="rounded bg-primary px-3 py-1 text-primary-foreground">Add</button>
      </div>

      {/* Rule list */}
      <ul className="space-y-1 text-sm">
        {rules.length === 0 && <li className="text-muted-foreground">No transitions yet.</li>}
        {rules.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <select value={r.action} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, action: e.target.value as 'block' | 'unblock' } : x)))} className="rounded border px-2 py-1">
              <option value="block">Block</option><option value="unblock">Unblock</option>
            </select>
            <span>at</span>
            <input type="time" value={toHHMM(r.time_min)} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, time_min: toMin(e.target.value) } : x)))} className="rounded border px-2 py-1" />
            <span>on {DAYS[r.weekday]}</span>
            <button type="button" onClick={() => setRules((p) => p.filter((_, j) => j !== i))} className="ml-auto text-destructive">Remove</button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={save} disabled={saving} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving…' : 'Save schedule'}
      </button>
    </div>
  );
}
