# Scheduled block/unblock with manual override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user define recurring block/unblock schedules (Melbourne time) for a device or group, with manual block/unblock taking precedence until the next scheduled transition.

**Architecture:** Declarative policy (tables `app_schedule_policies` + `app_schedule_rules`), evaluated each worker poll by a pure engine co-located in `runDeviceSync.ts`. The worker's existing reconcile pass computes "what state should this device be in right now?" and drives the router/DB to it. A manual action stamps `app_block_state.override_until = nextTransition(now)`; the reconcile honors the manual state until that instant, then resumes the policy.

**Tech Stack:** Next.js 16 (App Router, React 19), SQLite via better-sqlite3 + hazo_connect, hazo_jobs worker (`scripts/worker.mjs`), Zod, hazo_api (`ok`/`fail`), Intl-based timezone math (no TZ library).

## Global Constraints

- **Timezone:** `Australia/Melbourne` for all schedule evaluation. (Same offsets/DST as Sydney; this is the canonical label.)
- **`runDeviceSync.ts` purity (enforced — the worker imports it under native type-stripping):** NO `import 'server-only'`, NO `@/` path aliases, NO external runtime *value* imports (type-only imports are fine). Globals (`crypto.randomUUID`, `Intl`) are used directly. The pure schedule engine is therefore **defined in this file and exported**; other modules import it *from* `runDeviceSync.ts`.
- **Weekday convention everywhere:** `0 = Monday … 6 = Sunday`.
- **`time_min`:** integer `0…1439`, minutes past local midnight in the policy tz.
- **Testing convention (no test runner installed):** each backend task ships a self-contained autotest route under `src/app/api/<name>-test/route.ts`, mirroring `src/app/api/reconcile-test/route.ts` — throwaway temp SQLite DB, `runMigrations`, `FakeRouterProvider`, assertions returned as JSON with an `all_ok` boolean, and a production 404 guard. "Run the test" = with `npm run dev` running, `curl -s http://localhost:3051/api/<name>-test | python3 -m json.tool` and confirm `"all_ok": true`.
- **SQL adapter cast:** the hazo_connect SQLite adapter accepts `{ params }`; the generic type reflects PostgREST. Reuse the existing `type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> }` cast pattern (see `scheduleService.ts:32`).
- **Commit after every task.**

## File Structure

**Create:**
- `migrations/0008_schedule_policies.sql` — `app_schedule_policies`, `app_schedule_rules`, `app_block_state.override_until`.
- `src/server/schedules/policyService.ts` — server-only CRUD for policies+rules, `applyPolicyNow`, override clearing.
- `src/app/api/schedules/policies/route.ts` — `GET` (with live current-state/next-transition) + `POST` (upsert).
- `src/app/api/schedules/policies/[id]/route.ts` — `PATCH` (enable/disable), `DELETE`.
- `src/app/api/policy-engine-test/route.ts` — autotest for the pure engine.
- `src/app/api/policy-reconcile-test/route.ts` — autotest for reconcile + override hold + precedence + catch-up.
- `src/components/SchedulePolicyEditor.tsx` — client editor (rules list + quick-add helpers).

**Modify:**
- `src/server/sync/runDeviceSync.ts` — add exported pure engine (`policyState`, `nextTransition`, `PolicyRule`) + policy-aware reconcile in Phase 2.5.
- `src/server/devices/blockService.ts` — stamp `override_until` on manual block/unblock when an effective policy exists.
- `src/server/schedules/tz.ts` — relabel `Australia/Sydney` → `Australia/Melbourne`, export `TZ`.
- `package.json` (`worker` script) + `ecosystem.config.js` — `TZ=Australia/Melbourne`.
- `src/components/BlockTimerModal.tsx` — remove legacy `recurring`/`window` tabs (superseded by the editor); keep one-shot timer/future tabs.
- `src/app/(app)/explore/[id]/DeviceDetailScreen.tsx` and `src/app/(app)/explore/groups/[id]/GroupDetailScreen.tsx` — mount `SchedulePolicyEditor`.

---

## Task 1: Migration — policy tables + override column

**Files:**
- Create: `migrations/0008_schedule_policies.sql`

**Interfaces:**
- Produces: tables `app_schedule_policies (id, target_type, target_id, enabled, tz, label, created_by, created_at, updated_at)` UNIQUE on `(target_type, target_id)`; `app_schedule_rules (id, policy_id, weekday, time_min, action)`; new column `app_block_state.override_until TEXT`.

- [ ] **Step 1: Write the migration**

```sql
-- 0008_schedule_policies.sql
-- Declarative recurring block/unblock schedules ("policies") + manual-override hold.
--
-- A policy is a per-target (device|group) set of weekly transition rules. The
-- worker reconcile computes the desired state from these rules each poll. A
-- manual block/unblock stamps app_block_state.override_until so the manual state
-- is honored until the next scheduled transition, then the policy resumes.
--
-- Weekday convention: 0=Mon .. 6=Sun. time_min: 0..1439 local minutes past midnight.

CREATE TABLE IF NOT EXISTS app_schedule_policies (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,                       -- 'device' | 'group'
  target_id   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  tz          TEXT NOT NULL DEFAULT 'Australia/Melbourne',
  label       TEXT,
  created_by  TEXT,
  created_at  TEXT,
  updated_at  TEXT,
  UNIQUE (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS app_schedule_rules (
  id        TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES app_schedule_policies(id),
  weekday   INTEGER NOT NULL,                      -- 0=Mon .. 6=Sun
  time_min  INTEGER NOT NULL,                      -- 0..1439
  action    TEXT NOT NULL                          -- 'block' | 'unblock'
);
CREATE INDEX IF NOT EXISTS idx_schedule_rules_policy ON app_schedule_rules (policy_id);

-- Manual-override expiry instant (ISO-8601). NULL = no active override.
ALTER TABLE app_block_state ADD COLUMN override_until TEXT;
```

- [ ] **Step 2: Apply migrations**

Run: `npm run doctor >/dev/null 2>&1; node scripts/seed.mjs`
Expected: output includes `- 0008_schedule_policies.sql` in the applied list (first run only).

- [ ] **Step 3: Verify schema**

Run: `node -e "const D=require('better-sqlite3');const db=new D('darylweb.sqlite');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name IN ('app_schedule_policies','app_schedule_rules')\").all());console.log(db.prepare('PRAGMA table_info(app_block_state)').all().map(c=>c.name).join(','))"`
Expected: both table names listed; column list includes `override_until`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0008_schedule_policies.sql
git commit -m "feat(schedules): migration for policy tables + override_until column"
```

---

## Task 2: Pure schedule engine in runDeviceSync.ts

The engine is DST-correct by brute force: it materializes concrete UTC instants for each rule across a window around `now` (each instant built from its local wall time via the tz offset at that date), then reads off the current/next transition. No external imports.

**Files:**
- Modify: `src/server/sync/runDeviceSync.ts` (add an exported engine section near the top, after the imports/types block ~line 30)
- Create: `src/app/api/policy-engine-test/route.ts`

**Interfaces:**
- Produces (exported from `runDeviceSync.ts`):
  - `export interface PolicyRule { weekday: number; time_min: number; action: 'block' | 'unblock' }`
  - `export function policyState(rules: PolicyRule[], nowMs: number, tz?: string): 'block' | 'unblock' | null` — action of the most recent transition at-or-before `now`; `null` if `rules` empty. `tz` defaults to `'Australia/Melbourne'`.
  - `export function nextTransition(rules: PolicyRule[], nowMs: number, tz?: string): number | null` — epoch ms of the earliest transition strictly after `now`; `null` if `rules` empty.

- [ ] **Step 1: Write the failing autotest route**

Create `src/app/api/policy-engine-test/route.ts`:

```ts
/**
 * src/app/api/policy-engine-test/route.ts
 * Hermetic autotest for the pure schedule engine (policyState / nextTransition).
 * Returns 404 in production.
 */
import { policyState, nextTransition, type PolicyRule } from '@/server/sync/runDeviceSync';

export async function GET() {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });

  const checks: Record<string, boolean> = {};

  // "Blocked all day, allow 16:00-18:00" on Mon (weekday 0): unblock@960, block@1080.
  const allowWin: PolicyRule[] = [
    { weekday: 0, time_min: 960, action: 'unblock' },
    { weekday: 0, time_min: 1080, action: 'block' },
  ];
  // A Monday 17:00 Melbourne instant (winter, AEST = UTC+10) -> 07:00Z.
  const monWinter17 = Date.parse('2026-06-22T07:00:00.000Z'); // 2026-06-22 is a Monday
  checks.inside_window_unblocked = policyState(allowWin, monWinter17) === 'unblock';
  // Monday 12:00 (02:00Z) — before the unblock; most recent transition wraps to last week's block.
  const monWinter12 = Date.parse('2026-06-22T02:00:00.000Z');
  checks.before_window_blocked = policyState(allowWin, monWinter12) === 'block';
  // Next transition from 17:00 is the 18:00 block (08:00Z same day).
  checks.next_is_block = nextTransition(allowWin, monWinter17) === Date.parse('2026-06-22T08:00:00.000Z');

  // Wrap-around: rules only on Monday; evaluating on Wednesday must look back to Monday.
  const wed = Date.parse('2026-06-24T02:00:00.000Z');
  checks.wraparound_state = policyState(allowWin, wed) === 'block';
  checks.wraparound_next = nextTransition(allowWin, wed) === Date.parse('2026-06-29T06:00:00.000Z'); // next Mon 16:00 AEST

  // Empty rules -> null.
  checks.empty_state = policyState([], monWinter17) === null;
  checks.empty_next = nextTransition([], monWinter17) === null;

  // DST: AEDT (UTC+11) summer. Mon 2026-01-05 17:00 Melbourne = 06:00Z.
  const monSummer17 = Date.parse('2026-01-05T06:00:00.000Z');
  checks.dst_inside_unblocked = policyState(allowWin, monSummer17) === 'unblock';
  checks.dst_next_block = nextTransition(allowWin, monSummer17) === Date.parse('2026-01-05T07:00:00.000Z'); // 18:00 AEDT

  const all_ok = Object.values(checks).every(Boolean);
  return Response.json({ all_ok, checks });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `curl -s http://localhost:3051/api/policy-engine-test | python3 -m json.tool`
Expected: build/runtime error or 500 — `policyState`/`nextTransition` not exported yet. (Start `npm run dev` in another terminal if needed.)

- [ ] **Step 3: Implement the engine**

In `src/server/sync/runDeviceSync.ts`, immediately after the `type SyncAdapter = {...}` block (around line 30), insert:

```ts
// ---------------------------------------------------------------------------
// Pure schedule engine (co-located here, NOT in a separate module, because this
// file is imported by the plain-Node worker under native type-stripping which
// forbids external value imports / .ts extensions — see file header).
//
// Weekday convention: 0=Mon .. 6=Sun. time_min: 0..1439 local minutes.
// DST-correct: each candidate transition is materialized as a concrete UTC
// instant from its local wall time using the tz offset AT THAT DATE.
// ---------------------------------------------------------------------------

export interface PolicyRule {
  weekday: number;            // 0=Mon .. 6=Sun
  time_min: number;           // 0..1439
  action: 'block' | 'unblock';
}

const POLICY_TZ = 'Australia/Melbourne';

// Local-time parts of an instant in a given tz.
function tzParts(ms: number, tz: string): { y: number; mo: number; d: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wkMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    y: parseInt(p.year, 10), mo: parseInt(p.month, 10), d: parseInt(p.day, 10),
    weekday: wkMap[p.weekday as string],
  };
}

// UTC offset (ms) for an instant in tz (positive = ahead of UTC).
function tzOffsetMs(ms: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    parseInt(p.year, 10), parseInt(p.month, 10) - 1, parseInt(p.day, 10),
    parseInt(p.hour, 10), parseInt(p.minute, 10), parseInt(p.second, 10),
  );
  return asUtc - ms;
}

// Concrete UTC instant (ms) for a given local wall time on a specific calendar date.
function wallToUtcMs(y: number, mo: number, d: number, minutes: number, tz: string): number {
  const naiveUtc = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return naiveUtc - tzOffsetMs(naiveUtc, tz);
}

// Materialize sorted {ms, action} transition instants across [fromMs, fromMs + days*86400000].
function materialize(rules: PolicyRule[], fromMs: number, days: number, tz: string): { ms: number; action: 'block' | 'unblock' }[] {
  const out: { ms: number; action: 'block' | 'unblock' }[] = [];
  for (let i = 0; i <= days; i++) {
    const dayMs = fromMs + i * 86_400_000;
    const { y, mo, d, weekday } = tzParts(dayMs, tz);
    for (const r of rules) {
      if (r.weekday !== weekday) continue;
      out.push({ ms: wallToUtcMs(y, mo, d, r.time_min, tz), action: r.action });
    }
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

export function policyState(rules: PolicyRule[], nowMs: number, tz: string = POLICY_TZ): 'block' | 'unblock' | null {
  if (rules.length === 0) return null;
  // Look back up to 8 days for the most recent transition at-or-before now.
  const pts = materialize(rules, nowMs - 8 * 86_400_000, 9, tz);
  let last: 'block' | 'unblock' | null = null;
  for (const p of pts) { if (p.ms <= nowMs) last = p.action; else break; }
  return last;
}

export function nextTransition(rules: PolicyRule[], nowMs: number, tz: string = POLICY_TZ): number | null {
  if (rules.length === 0) return null;
  const pts = materialize(rules, nowMs - 86_400_000, 9, tz);
  for (const p of pts) { if (p.ms > nowMs) return p.ms; }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `curl -s http://localhost:3051/api/policy-engine-test | python3 -m json.tool`
Expected: `"all_ok": true` and every entry in `checks` true.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/sync/runDeviceSync.ts src/app/api/policy-engine-test/route.ts
git commit -m "feat(schedules): pure DST-correct policy engine (policyState/nextTransition)"
```

---

## Task 3: policyService — CRUD + apply-now + override clearing

**Files:**
- Create: `src/server/schedules/policyService.ts`

**Interfaces:**
- Consumes: `policyState`, `nextTransition`, `PolicyRule` from `@/server/sync/runDeviceSync`; `runBlockAction` from `../devices/blockActions`; `runGroupBlockAction` from `../groups/groupBlockActions`.
- Produces:
  - `interface PolicyWithRules { id: string; target_type: 'device'|'group'; target_id: string; enabled: boolean; tz: string; label: string|null; rules: PolicyRule[] }`
  - `getPolicy(adapter, targetType, targetId): Promise<PolicyWithRules | null>`
  - `getEnabledPolicyForDevice(adapter, deviceId): Promise<PolicyWithRules | null>` — device-level if present, else the policy of the device's `primary_group_id`. Only returns `enabled` policies.
  - `upsertPolicy(adapter, opts): Promise<PolicyWithRules>` where `opts = { targetType, targetId, enabled, label?, rules, actor: { userId?: string|null } }` — replaces rules wholesale.
  - `setPolicyEnabled(adapter, id, enabled): Promise<void>`
  - `deletePolicy(adapter, id): Promise<void>`
  - `applyPolicyNow(adapter, provider, targetType, targetId, actor): Promise<void>` — compute `policyState(now)` and drive the target to it via `runBlockAction`/`runGroupBlockAction` (blocked_by label `'schedule'`); clears `override_until` for affected device(s).
  - `clearOverrideForTarget(adapter, targetType, targetId): Promise<void>`

- [ ] **Step 1: Write the service**

```ts
/**
 * src/server/schedules/policyService.ts
 * Server-only CRUD + lifecycle for declarative recurring schedule policies.
 */
import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import type { RouterProvider } from '../router/RouterProvider';
import { policyState, nextTransition, type PolicyRule } from '@/server/sync/runDeviceSync';
import { runBlockAction } from '../devices/blockActions';
import { runGroupBlockAction } from '../groups/groupBlockActions';

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };
const raw = (a: HazoConnectAdapter): RawAdapter => a as unknown as RawAdapter;

export interface PolicyWithRules {
  id: string;
  target_type: 'device' | 'group';
  target_id: string;
  enabled: boolean;
  tz: string;
  label: string | null;
  rules: PolicyRule[];
}

const POLICY_TZ = 'Australia/Melbourne';

async function loadRules(adapter: HazoConnectAdapter, policyId: string): Promise<PolicyRule[]> {
  const rows = await raw(adapter).rawQuery(
    `SELECT weekday, time_min, action FROM app_schedule_rules WHERE policy_id = ? ORDER BY weekday, time_min`,
    { params: [policyId] },
  );
  return rows.map((r) => ({ weekday: Number(r.weekday), time_min: Number(r.time_min), action: r.action }));
}

async function loadPolicyRow(adapter: HazoConnectAdapter, where: string, params: unknown[]): Promise<PolicyWithRules | null> {
  const rows = await raw(adapter).rawQuery(`SELECT * FROM app_schedule_policies WHERE ${where} LIMIT 1`, { params });
  if (rows.length === 0) return null;
  const p = rows[0];
  return {
    id: p.id, target_type: p.target_type, target_id: p.target_id,
    enabled: Number(p.enabled) === 1, tz: p.tz ?? POLICY_TZ, label: p.label ?? null,
    rules: await loadRules(adapter, p.id),
  };
}

export async function getPolicy(adapter: HazoConnectAdapter, targetType: 'device' | 'group', targetId: string): Promise<PolicyWithRules | null> {
  return loadPolicyRow(adapter, 'target_type = ? AND target_id = ?', [targetType, targetId]);
}

export async function getEnabledPolicyForDevice(adapter: HazoConnectAdapter, deviceId: string): Promise<PolicyWithRules | null> {
  const own = await loadPolicyRow(adapter, "target_type = 'device' AND target_id = ? AND enabled = 1", [deviceId]);
  if (own) return own;
  const dev = await raw(adapter).rawQuery(`SELECT primary_group_id FROM app_devices WHERE id = ?`, { params: [deviceId] });
  const gid = dev[0]?.primary_group_id;
  if (!gid) return null;
  return loadPolicyRow(adapter, "target_type = 'group' AND target_id = ? AND enabled = 1", [gid]);
}

export async function upsertPolicy(adapter: HazoConnectAdapter, opts: {
  targetType: 'device' | 'group'; targetId: string; enabled: boolean;
  label?: string | null; rules: PolicyRule[]; actor: { userId?: string | null };
}): Promise<PolicyWithRules> {
  const now = new Date().toISOString();
  const existing = await getPolicy(adapter, opts.targetType, opts.targetId);
  const id = existing?.id ?? 'pol_' + crypto.randomUUID();
  if (existing) {
    await raw(adapter).rawQuery(
      `UPDATE app_schedule_policies SET enabled = ?, label = ?, tz = ?, updated_at = ? WHERE id = ?`,
      { params: [opts.enabled ? 1 : 0, opts.label ?? null, POLICY_TZ, now, id] },
    );
    await raw(adapter).rawQuery(`DELETE FROM app_schedule_rules WHERE policy_id = ?`, { params: [id] });
  } else {
    await raw(adapter).rawQuery(
      `INSERT INTO app_schedule_policies (id, target_type, target_id, enabled, tz, label, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      { params: [id, opts.targetType, opts.targetId, opts.enabled ? 1 : 0, POLICY_TZ, opts.label ?? null, opts.actor.userId ?? null, now, now] },
    );
  }
  for (const r of opts.rules) {
    await raw(adapter).rawQuery(
      `INSERT INTO app_schedule_rules (id, policy_id, weekday, time_min, action) VALUES (?, ?, ?, ?, ?)`,
      { params: ['rul_' + crypto.randomUUID(), id, r.weekday, r.time_min, r.action] },
    );
  }
  return (await getPolicy(adapter, opts.targetType, opts.targetId))!;
}

export async function setPolicyEnabled(adapter: HazoConnectAdapter, id: string, enabled: boolean): Promise<void> {
  await raw(adapter).rawQuery(
    `UPDATE app_schedule_policies SET enabled = ?, updated_at = ? WHERE id = ?`,
    { params: [enabled ? 1 : 0, new Date().toISOString(), id] },
  );
}

export async function deletePolicy(adapter: HazoConnectAdapter, id: string): Promise<void> {
  await raw(adapter).rawQuery(`DELETE FROM app_schedule_rules WHERE policy_id = ?`, { params: [id] });
  await raw(adapter).rawQuery(`DELETE FROM app_schedule_policies WHERE id = ?`, { params: [id] });
}

export async function clearOverrideForTarget(adapter: HazoConnectAdapter, targetType: 'device' | 'group', targetId: string): Promise<void> {
  if (targetType === 'device') {
    await raw(adapter).rawQuery(`UPDATE app_block_state SET override_until = NULL WHERE device_id = ?`, { params: [targetId] });
  } else {
    await raw(adapter).rawQuery(
      `UPDATE app_block_state SET override_until = NULL WHERE device_id IN (SELECT device_id FROM app_group_members WHERE group_id = ?)`,
      { params: [targetId] },
    );
  }
}

export async function applyPolicyNow(
  adapter: HazoConnectAdapter, provider: RouterProvider,
  targetType: 'device' | 'group', targetId: string, actor: { userId?: string | null },
): Promise<void> {
  const policy = await getPolicy(adapter, targetType, targetId);
  if (!policy || !policy.enabled || policy.rules.length === 0) return;
  const desired = policyState(policy.rules, Date.now(), policy.tz);
  if (!desired) return;
  const gate = { authorized: true, actorLabel: 'schedule', actorUserId: actor.userId ?? null };
  const action = desired === 'block' ? 'block' : 'unblock';
  if (targetType === 'device') await runBlockAction(adapter, provider, gate, targetId, action);
  else await runGroupBlockAction(adapter, provider, gate, targetId, action);
  await clearOverrideForTarget(adapter, targetType, targetId);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/schedules/policyService.ts
git commit -m "feat(schedules): policyService CRUD, apply-now, override clearing"
```

*(This task's behavior is exercised end-to-end by the autotest in Task 5.)*

---

## Task 4: Override stamping in blockService

A manual block/unblock on a policy-governed device stamps `override_until = nextTransition(now)` so the reconcile honors the manual state until then.

**Files:**
- Modify: `src/server/devices/blockService.ts`

**Interfaces:**
- Consumes: `nextTransition` from `@/server/sync/runDeviceSync`; `getEnabledPolicyForDevice` from `../schedules/policyService`.
- Produces: `app_block_state.override_until` set to the next-transition ISO (or NULL when no enabled policy) on both block and unblock writes.

- [ ] **Step 1: Add the override helper + imports**

At the top of `src/server/devices/blockService.ts`, after the existing imports (line 7), add:

```ts
import { nextTransition } from '@/server/sync/runDeviceSync';
import { getEnabledPolicyForDevice } from '../schedules/policyService';

// Returns the ISO instant a manual override should hold until (next scheduled
// transition), or null when the device has no enabled policy.
async function computeOverrideUntil(adapter: HazoConnectAdapter, deviceId: string): Promise<string | null> {
  const policy = await getEnabledPolicyForDevice(adapter, deviceId);
  if (!policy || policy.rules.length === 0) return null;
  const ms = nextTransition(policy.rules, Date.now(), policy.tz);
  return ms == null ? null : new Date(ms).toISOString();
}
```

- [ ] **Step 2: Stamp override on block**

In `blockDevice`, replace the `row` object (lines 72-76) with a version that includes `override_until`. Insert before it:

```ts
  const overrideUntil = await computeOverrideUntil(adapter, deviceId);
```

Then change the `row` to add the field:

```ts
  const row = {
    device_id: deviceId, is_blocked: 1, blocked_by: opts.actor.label, blocked_at: now,
    reason: opts.reason ?? null, scheduled_unblock_at: null, unblock_job_id: null,
    router_synced: routerSynced ? 1 : 0, override_until: overrideUntil,
  };
```

- [ ] **Step 3: Stamp override on unblock**

In `unblockDevice`, before the `row` object (line 116) insert:

```ts
  const overrideUntil = await computeOverrideUntil(adapter, deviceId);
```

Then change the `row` (lines 116-119) to set `override_until` instead of implicitly leaving it:

```ts
  const row = {
    device_id: deviceId, is_blocked: 0, blocked_by: null, blocked_at: null, reason: null,
    scheduled_unblock_at: null, unblock_job_id: null, router_synced: routerSynced ? 1 : 0,
    override_until: overrideUntil,
  };
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/devices/blockService.ts
git commit -m "feat(schedules): stamp override_until on manual block/unblock"
```

*(Exercised by the reconcile autotest in Task 6.)*

---

## Task 5: Policy API routes + apply-on-create

**Files:**
- Create: `src/app/api/schedules/policies/route.ts`
- Create: `src/app/api/schedules/policies/[id]/route.ts`

**Interfaces:**
- Consumes: `getPolicy`, `upsertPolicy`, `setPolicyEnabled`, `deletePolicy`, `applyPolicyNow`, `clearOverrideForTarget` from `@/server/schedules/policyService`; `policyState`, `nextTransition` from `@/server/sync/runDeviceSync`; `authorizeCapability`, `getDb`, `getRouterProvider`, `resolveServerAuth`.
- Produces: `GET /api/schedules/policies?targetType&targetId` → `{ policy, currentState, nextTransitionISO }`; `POST /api/schedules/policies` (upsert, then apply-now); `PATCH /api/schedules/policies/[id]` (enable/disable); `DELETE /api/schedules/policies/[id]`.

- [ ] **Step 1: Write the collection route**

Create `src/app/api/schedules/policies/route.ts`:

```ts
import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getRouterProvider } from '@/server/router';
import { authorizeCapability } from '@/server/permissions/authorize';
import { getPolicy, upsertPolicy, applyPolicyNow } from '@/server/schedules/policyService';
import { policyState, nextTransition } from '@/server/sync/runDeviceSync';

const RuleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time_min: z.number().int().min(0).max(1439),
  action: z.enum(['block', 'unblock']),
});
const Body = z.object({
  targetType: z.enum(['device', 'group']),
  targetId: z.string().min(1),
  enabled: z.boolean().default(true),
  label: z.string().optional(),
  rules: z.array(RuleSchema).max(200),
});

export const GET = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const url = new URL(req.url);
  const targetType = url.searchParams.get('targetType') as 'device' | 'group' | null;
  const targetId = url.searchParams.get('targetId');
  if (!targetType || !targetId) return fail('VALIDATION_FAILED', 'targetType and targetId required');

  const adapter = getDb();
  const policy = await getPolicy(adapter, targetType, targetId);
  const now = Date.now();
  const currentState = policy && policy.enabled ? policyState(policy.rules, now, policy.tz) : null;
  const nt = policy && policy.enabled ? nextTransition(policy.rules, now, policy.tz) : null;
  return ok({ policy, currentState, nextTransitionISO: nt == null ? null : new Date(nt).toISOString() });
});

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  let json: unknown;
  try { json = await req.json(); } catch { return fail('VALIDATION_FAILED', 'Invalid JSON body'); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join('; '));
  const { targetType, targetId, enabled, label, rules } = parsed.data;

  const adapter = getDb();
  const target = targetType === 'device' ? { deviceId: targetId } : { scopeType: 'group' as const, scopeId: targetId };
  const decision = await authorizeCapability(adapter, { subject: auth.subject, isSuperadmin: auth.isSuperadmin }, 'schedule.create', target);
  if (!decision.allowed) return fail('FORBIDDEN', decision.reason);

  const policy = await upsertPolicy(adapter, { targetType, targetId, enabled, label: label ?? null, rules, actor: { userId: auth.subject } });
  // Apply the policy's current desired state immediately (best-effort).
  try {
    const provider = await getRouterProvider();
    if (enabled) await applyPolicyNow(adapter, provider, targetType, targetId, { userId: auth.subject });
  } catch { /* worker reconcile will converge on next poll */ }

  return ok({ policy });
});
```

- [ ] **Step 2: Write the item route**

Create `src/app/api/schedules/policies/[id]/route.ts`:

```ts
import { ok, fail, withRequestContext } from 'hazo_api';
import { z } from 'zod';
import { resolveServerAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { setPolicyEnabled, deletePolicy } from '@/server/schedules/policyService';

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };

async function targetOf(adapter: RawAdapter, id: string): Promise<{ target_type: 'device' | 'group'; target_id: string } | null> {
  const rows = await adapter.rawQuery(`SELECT target_type, target_id FROM app_schedule_policies WHERE id = ?`, { params: [id] });
  return rows[0] ?? null;
}
async function clearOverride(adapter: RawAdapter, t: { target_type: 'device' | 'group'; target_id: string }) {
  if (t.target_type === 'device') {
    await adapter.rawQuery(`UPDATE app_block_state SET override_until = NULL WHERE device_id = ?`, { params: [t.target_id] });
  } else {
    await adapter.rawQuery(`UPDATE app_block_state SET override_until = NULL WHERE device_id IN (SELECT device_id FROM app_group_members WHERE group_id = ?)`, { params: [t.target_id] });
  }
}

const PatchBody = z.object({ enabled: z.boolean() });

export const PATCH = withRequestContext(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const { id } = await ctx.params;
  let json: unknown;
  try { json = await req.json(); } catch { return fail('VALIDATION_FAILED', 'Invalid JSON body'); }
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) return fail('VALIDATION_FAILED', 'enabled (boolean) required');

  const adapter = getDb() as unknown as RawAdapter;
  const t = await targetOf(adapter, id);
  if (!t) return fail('NOT_FOUND', 'Policy not found');
  await setPolicyEnabled(getDb(), id, parsed.data.enabled);
  if (!parsed.data.enabled) await clearOverride(adapter, t); // disabling drops any active hold
  return ok({ id, enabled: parsed.data.enabled });
});

export const DELETE = withRequestContext(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');
  const { id } = await ctx.params;
  const adapter = getDb() as unknown as RawAdapter;
  const t = await targetOf(adapter, id);
  if (!t) return fail('NOT_FOUND', 'Policy not found');
  await deletePolicy(getDb(), id);
  await clearOverride(adapter, t);
  return ok({ id, deleted: true });
});
```

- [ ] **Step 3: Verify `schedule.create` capability exists**

Run: `grep -rn "schedule.create" src/server/permissions src/app/api/schedules/route.ts`
Expected: at least the existing usage in `src/app/api/schedules/route.ts` (capability already in use). If a capability registry enumerates allowed capabilities, confirm `schedule.create` is listed; the existing schedules POST already relies on it, so no new registration is needed.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/schedules/policies/
git commit -m "feat(schedules): policy API routes (GET/POST/PATCH/DELETE) with apply-on-create"
```

---

## Task 6: Policy-aware reconcile in runDeviceSync (worker engine)

This is the core runtime behavior. In `reapply` mode, devices with an effective enabled policy are reconciled to `policyState(now)` in **both directions**, honoring an active `override_until` hold; non-policy devices keep today's re-block-only behavior.

**Files:**
- Modify: `src/server/sync/runDeviceSync.ts` (Phase 2.5, the `if (blockReconcile === 'reapply')` block, lines 149-191)
- Create: `src/app/api/policy-reconcile-test/route.ts`

**Interfaces:**
- Consumes: in-module `policyState`, `PolicyRule`; `provider.setInternetAccess`, optional `provider.getBlockState`.
- Produces: `SyncSummary.reapplied` now also counts policy-driven transitions; policy devices excluded from the legacy re-block loop. (No signature change.)

- [ ] **Step 1: Write the failing autotest route**

Create `src/app/api/policy-reconcile-test/route.ts`:

```ts
/**
 * src/app/api/policy-reconcile-test/route.ts
 * Hermetic autotest: policy-driven reconcile + manual-override hold + precedence.
 * Returns 404 in production.
 */
import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import { FakeRouterProvider } from '@/server/router/FakeRouterProvider';
import { runDeviceSync } from '@/server/sync/runDeviceSync';
import os from 'os';
import path from 'path';
import fs from 'fs';

type RawAdapter = { rawQuery(sql: string, opts?: { params?: unknown[] }): Promise<any[]> };
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export async function GET() {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });
  const tmpDb = path.join(os.tmpdir(), `darylweb_policy_reconcile_${Date.now()}_${Math.floor(Math.random() * 1e9)}.sqlite`);
  const checks: Record<string, boolean> = {};
  try {
    const rawAdapter = createHazoConnect({ type: 'sqlite', sqlite: { database_path: tmpDb, driver: 'better-sqlite3' } });
    const adapter = rawAdapter as unknown as RawAdapter;
    await runMigrations(rawAdapter, { directory: MIGRATIONS_DIR });

    const provider = new FakeRouterProvider();
    const clients = await provider.getClientList();
    const mac = clients[0].mac; // an online device

    // Seed device d1 mapped to that MAC via an initial sync.
    const tBase = Date.parse('2026-06-22T07:00:00.000Z'); // Mon 17:00 Melbourne (winter)
    await runDeviceSync(adapter, provider, new Date(tBase).toISOString(), { intervalSec: 60 });
    const d1 = (await adapter.rawQuery(`SELECT id FROM app_devices WHERE mac = ?`, { params: [mac] }))[0].id;

    // Policy: blocked all day, allow 16:00-18:00 Mon (weekday 0). unblock@960, block@1080.
    const pid = 'pol_test';
    await adapter.rawQuery(
      `INSERT INTO app_schedule_policies (id, target_type, target_id, enabled, tz, created_at) VALUES (?, 'device', ?, 1, 'Australia/Melbourne', ?)`,
      { params: [pid, d1, new Date().toISOString()] });
    await adapter.rawQuery(`INSERT INTO app_schedule_rules (id,policy_id,weekday,time_min,action) VALUES ('r1',?,0,960,'unblock')`, { params: [pid] });
    await adapter.rawQuery(`INSERT INTO app_schedule_rules (id,policy_id,weekday,time_min,action) VALUES ('r2',?,0,1080,'block')`, { params: [pid] });

    const blocked = async () => Number((await adapter.rawQuery(`SELECT COALESCE(is_blocked,0) b FROM app_block_state WHERE device_id = ?`, { params: [d1] }))[0]?.b ?? 0) === 1;

    // (A) At 17:00 (inside window) reconcile -> unblocked.
    await runDeviceSync(adapter, provider, new Date(tBase).toISOString(), { intervalSec: 60 });
    checks.inside_window_unblocked = (await blocked()) === false;

    // (B) At 19:00 (after 18:00 block) reconcile -> blocked.
    const t19 = Date.parse('2026-06-22T09:00:00.000Z');
    await runDeviceSync(adapter, provider, new Date(t19).toISOString(), { intervalSec: 60 });
    checks.after_window_blocked = (await blocked()) === true;

    // (C) Manual unblock at 19:30 with override_until = next transition (next Mon 16:00).
    await adapter.rawQuery(`UPDATE app_block_state SET is_blocked = 0, override_until = ? WHERE device_id = ?`,
      { params: [new Date(Date.parse('2026-06-29T06:00:00.000Z')).toISOString(), d1] });
    await provider.setInternetAccess(mac, true);
    const t1930 = Date.parse('2026-06-22T09:30:00.000Z');
    await runDeviceSync(adapter, provider, new Date(t1930).toISOString(), { intervalSec: 60 });
    checks.override_holds = (await blocked()) === false; // policy says block, but hold wins

    // (D) Next Monday 16:30 (override expired, inside next allow window) -> unblocked + override cleared.
    const tNextMon = Date.parse('2026-06-29T06:30:00.000Z');
    await runDeviceSync(adapter, provider, new Date(tNextMon).toISOString(), { intervalSec: 60 });
    const ov = (await adapter.rawQuery(`SELECT override_until FROM app_block_state WHERE device_id = ?`, { params: [d1] }))[0]?.override_until;
    checks.override_cleared = ov == null;
    checks.next_window_unblocked = (await blocked()) === false;

    const all_ok = Object.values(checks).every(Boolean);
    return Response.json({ all_ok, checks });
  } catch (e) {
    return Response.json({ all_ok: false, error: String(e) }, { status: 500 });
  } finally {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `curl -s http://localhost:3051/api/policy-reconcile-test | python3 -m json.tool`
Expected: `all_ok: false` — without policy reconcile, `inside_window_unblocked` and `override_holds` fail (the legacy pass only re-blocks).

- [ ] **Step 3: Replace the reapply block with policy-aware reconcile**

In `src/server/sync/runDeviceSync.ts`, replace the entire `if (blockReconcile === 'reapply') try { ... } catch ... }` block (lines 149-191) with:

```ts
  if (blockReconcile === 'reapply') try {
    const nowMs = Date.parse(nowIso);

    // Build effective-policy map: deviceId -> { rules, tz }. Device-level policy
    // wins; otherwise the device's primary_group_id group policy applies.
    const policyRows = (await adapter.rawQuery(
      `SELECT id, target_type, target_id, tz FROM app_schedule_policies WHERE enabled = 1`,
    )) as { id: string; target_type: string; target_id: string; tz: string }[];
    const ruleRows = (await adapter.rawQuery(
      `SELECT policy_id, weekday, time_min, action FROM app_schedule_rules`,
    )) as { policy_id: string; weekday: number; time_min: number; action: 'block' | 'unblock' }[];
    const rulesByPolicy = new Map<string, PolicyRule[]>();
    for (const r of ruleRows) {
      const arr = rulesByPolicy.get(r.policy_id) ?? [];
      arr.push({ weekday: Number(r.weekday), time_min: Number(r.time_min), action: r.action });
      rulesByPolicy.set(r.policy_id, arr);
    }
    const devicePolicy = new Map<string, { rules: PolicyRule[]; tz: string }>();
    const groupPolicy = new Map<string, { rules: PolicyRule[]; tz: string }>();
    for (const p of policyRows) {
      const entry = { rules: rulesByPolicy.get(p.id) ?? [], tz: p.tz || 'Australia/Melbourne' };
      if (p.target_type === 'device') devicePolicy.set(p.target_id, entry);
      else groupPolicy.set(p.target_id, entry);
    }
    // Resolve effective policy per device that has any state row OR is targeted.
    const allDevices = (await adapter.rawQuery(
      `SELECT d.id AS id, d.mac AS mac, d.status AS status, d.primary_group_id AS gid,
              COALESCE(b.is_blocked,0) AS is_blocked, b.router_synced AS router_synced, b.override_until AS override_until
         FROM app_devices d LEFT JOIN app_block_state b ON b.device_id = d.id`,
    )) as { id: string; mac: string; status: string; gid: string | null; is_blocked: number; router_synced: number | null; override_until: string | null }[];

    const policyDeviceIds = new Set<string>();

    for (const d of allDevices) {
      const eff = devicePolicy.get(d.id) ?? (d.gid ? groupPolicy.get(d.gid) : undefined);
      if (!eff || eff.rules.length === 0) continue;
      policyDeviceIds.add(d.id);
      if (d.status !== 'online') continue; // offline: corrected when it returns

      // Honor an active manual-override hold.
      if (d.override_until && nowMs < Date.parse(d.override_until)) continue;

      const desired = policyState(eff.rules, nowMs, eff.tz); // 'block' | 'unblock' | null
      if (!desired) continue;
      const wantBlocked = desired === 'block';
      const isBlocked = Number(d.is_blocked) === 1;
      const overrideExpired = d.override_until != null && nowMs >= Date.parse(d.override_until);

      if (wantBlocked !== isBlocked) {
        const res = await provider.setInternetAccess(d.mac, !wantBlocked); // enabled=true means unblock
        const nowIso2 = nowIso;
        await adapter.rawQuery(
          `INSERT INTO app_block_state (device_id, is_blocked, blocked_by, blocked_at, router_synced, override_until)
           VALUES (?, ?, 'schedule', ?, ?, NULL)
           ON CONFLICT(device_id) DO UPDATE SET
             is_blocked = excluded.is_blocked, blocked_by = 'schedule',
             blocked_at = excluded.blocked_at, router_synced = excluded.router_synced, override_until = NULL`,
          { params: [d.id, wantBlocked ? 1 : 0, nowIso2, res.success ? 1 : 0] },
        );
        try {
          await adapter.rawQuery(
            `INSERT INTO hazo_audit_intent (id, correlation_id, event_name, payload, subject_kind, subject_id, actor_kind, occurred_at)
             VALUES (?, ?, 'device_block_scheduled', ?, 'device', ?, 'background_job', ?)`,
            { params: [crypto.randomUUID(), crypto.randomUUID(), JSON.stringify({ mac: d.mac, desired, router_synced: res.success }), d.id, nowIso] },
          );
        } catch { /* audit best-effort */ }
        summary.reapplied++;
      } else if (overrideExpired) {
        // State already matches policy; just clear the stale hold.
        await adapter.rawQuery(`UPDATE app_block_state SET override_until = NULL WHERE device_id = ?`, { params: [d.id] });
      }
    }

    // Legacy re-block-only pass for devices WITHOUT an effective policy.
    const blockedRows = (await adapter.rawQuery(
      `SELECT b.device_id AS device_id, d.mac AS mac, b.router_synced AS router_synced
         FROM app_block_state b JOIN app_devices d ON d.id = b.device_id
        WHERE b.is_blocked = 1`,
    )) as { device_id: string; mac: string; router_synced: number }[];

    for (const b of blockedRows) {
      if (policyDeviceIds.has(b.device_id)) continue; // handled by policy reconcile above
      let routerState: boolean | null = null;
      if (typeof provider.getBlockState === 'function') routerState = await provider.getBlockState(b.mac);
      if (routerState !== true) {
        const res = await provider.setInternetAccess(b.mac, false);
        await adapter.rawQuery(`UPDATE app_block_state SET router_synced = ? WHERE device_id = ?`, { params: [res.success ? 1 : 0, b.device_id] });
        try {
          await adapter.rawQuery(
            `INSERT INTO hazo_audit_intent (id, correlation_id, event_name, payload, subject_kind, subject_id, actor_kind, occurred_at)
             VALUES (?, ?, 'device_block_reapplied', ?, 'device', ?, 'background_job', ?)`,
            { params: [crypto.randomUUID(), crypto.randomUUID(), JSON.stringify({ mac: b.mac, router_state: routerState, router_synced: res.success }), b.device_id, nowIso] },
          );
        } catch { /* audit best-effort */ }
        summary.reapplied++;
      } else if (b.router_synced !== 1) {
        await adapter.rawQuery(`UPDATE app_block_state SET router_synced = 1 WHERE device_id = ?`, { params: [b.device_id] });
      }
    }
  } catch (err) {
    console.warn('[runDeviceSync] reapply reconcile failed (non-fatal):', err);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `curl -s http://localhost:3051/api/policy-reconcile-test | python3 -m json.tool`
Expected: `"all_ok": true`, all checks true.

- [ ] **Step 5: Re-run the earlier autotests for regressions**

Run: `for r in reconcile-test sync-test policy-engine-test; do echo "== $r =="; curl -s http://localhost:3051/api/$r | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('all_ok', d))"; done`
Expected: `reconcile-test` and `sync-test` still pass (their devices have no policy → legacy path unchanged); `policy-engine-test` true.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/server/sync/runDeviceSync.ts src/app/api/policy-reconcile-test/route.ts
git commit -m "feat(schedules): policy-aware reconcile with manual-override hold in runDeviceSync"
```

---

## Task 7: Timezone relabel to Melbourne

**Files:**
- Modify: `src/server/schedules/tz.ts`
- Modify: `package.json` (`worker` script)
- Modify: `ecosystem.config.js`

**Interfaces:**
- Produces: `export const TZ = 'Australia/Melbourne'` from `tz.ts`; worker processes launched with `TZ=Australia/Melbourne`.

- [ ] **Step 1: Relabel tz.ts**

In `src/server/schedules/tz.ts` change line 12 from `const TZ = 'Australia/Sydney';` to:

```ts
export const TZ = 'Australia/Melbourne';
```

Update the file's top doc comment (lines 3-7): replace "AEST (Australia/Sydney)" with "Melbourne (Australia/Melbourne)".

- [ ] **Step 2: Update worker launch TZ**

In `package.json`, change the `worker` script value from `TZ=Australia/Sydney node --conditions=react-server scripts/worker.mjs` to `TZ=Australia/Melbourne node --conditions=react-server scripts/worker.mjs`.

In `ecosystem.config.js`, find the worker app's env (read the file first: `grep -n "Australia/Sydney\|TZ" ecosystem.config.js`) and replace `Australia/Sydney` with `Australia/Melbourne`.

- [ ] **Step 3: Verify no remaining Sydney references in scheduling paths**

Run: `grep -rn "Australia/Sydney" src scripts package.json ecosystem.config.js`
Expected: no matches (or only inside historical comments you intentionally keep).

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/server/schedules/tz.ts package.json ecosystem.config.js
git commit -m "chore(schedules): use Australia/Melbourne timezone everywhere"
```

---

## Task 8: Schedule editor UI + integration

**Files:**
- Create: `src/components/SchedulePolicyEditor.tsx`
- Modify: `src/app/(app)/explore/[id]/DeviceDetailScreen.tsx`
- Modify: `src/app/(app)/explore/groups/[id]/GroupDetailScreen.tsx`
- Modify: `src/components/BlockTimerModal.tsx` (remove legacy recurring/window tabs)

**Interfaces:**
- Consumes: `GET/POST /api/schedules/policies`. Component prop: `SchedulePolicyEditor({ targetType, targetId }: { targetType: 'device' | 'group'; targetId: string })`.

- [ ] **Step 1: Build the editor component**

Create `src/components/SchedulePolicyEditor.tsx`:

```tsx
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
```

- [ ] **Step 2: Mount it on device & group detail**

In `src/app/(app)/explore/[id]/DeviceDetailScreen.tsx`: read the file, add `import { SchedulePolicyEditor } from '@/components/SchedulePolicyEditor';` and render `<SchedulePolicyEditor targetType="device" targetId={device.id} />` in the detail body (near the existing block controls / `BlockTimerModal`).

In `src/app/(app)/explore/groups/[id]/GroupDetailScreen.tsx`: same, with `targetType="group"` and the group's id.

- [ ] **Step 3: Remove legacy recurring/window tabs**

Read `src/components/BlockTimerModal.tsx`, locate the `recurring` and `window` tab buttons and their panels (the modal has Timer / Future / Recurring tabs per its current implementation), and remove the recurring + window tab entries and panels. Keep the Timer and Future one-shot tabs. The recurring/window functionality is now the `SchedulePolicyEditor`.

- [ ] **Step 4: Manual UI verification**

With `npm run dev` running, open a device detail page, use the **Allow window** quick-add (16:00–18:00, Mon–Fri), Save. Then:

Run: `curl -s "http://localhost:3051/api/schedules/policies?targetType=device&targetId=<deviceId>" | python3 -m json.tool`
Expected: `data.policy.rules` contains the 10 generated rules; `data.currentState` is `block` or `unblock` consistent with the current Melbourne time; `data.nextTransitionISO` is set.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/components/SchedulePolicyEditor.tsx src/app/\(app\)/explore/ src/components/BlockTimerModal.tsx
git commit -m "feat(schedules): schedule editor UI with allow/block-window quick-add; retire legacy recurring tabs"
```

---

## Task 9: End-to-end smoke + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-22-scheduled-block-unblock-design.md` (mark Implemented; note any deviations)

- [ ] **Step 1: Full autotest sweep**

Run: `for r in sync-test reconcile-test policy-engine-test policy-reconcile-test schedules-test; do echo "== $r =="; curl -s http://localhost:3051/api/$r | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('all_ok', d))"; done`
Expected: all `True`.

- [ ] **Step 2: Worker live check (fake provider)**

Run (in a scratch terminal, fake provider so it's safe): `ROUTER_PROVIDER=fake TZ=Australia/Melbourne timeout 8 node --conditions=react-server scripts/worker.mjs 2>&1 | grep -i "netwarden.sync processed" | head -2`
Expected: at least one `netwarden.sync processed` line, no unhandled exceptions.

- [ ] **Step 3: Update the design doc status**

Edit the spec's `**Status:**` line to `Implemented — 2026-06-22`. Add a short "Deviations" note if the engine was co-located in `runDeviceSync.ts` (it was) or anything else diverged.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-22-scheduled-block-unblock-design.md
git commit -m "docs(schedules): mark scheduled block/unblock implemented"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** data model → Task 1; engine `policyState`/`nextTransition` → Task 2; override "hold until next transition" → Tasks 4 (stamp) + 6 (honor/clear); worker both-direction reconcile + precedence (device > group via primary_group_id) + offline catch-up → Task 6; editor UI + allow/block-window quick-add + "now/next" readout → Task 8; API → Task 5; Melbourne tz → Task 7; legacy recurring/window UI retired in favor of policies → Task 8; apply-on-create → Task 5; disable/delete clears override → Tasks 5/6; testing (engine, override hold, catch-up, precedence) → Tasks 2 + 6.
- **Placeholder scan:** none — all steps carry concrete code/commands.
- **Type consistency:** `PolicyRule { weekday; time_min; action }` and `policyState`/`nextTransition` signatures are identical across Tasks 2, 3, 4, 5, 6. Weekday `0=Mon` and `time_min 0..1439` used uniformly. `blocked_by='schedule'` label consistent between `applyPolicyNow` (Task 3) and reconcile (Task 6).
- **Known deviation from spec:** the pure engine lives in `runDeviceSync.ts` (exported), not a standalone `policyEngine.ts`, because the worker imports `runDeviceSync` under native type-stripping that forbids external value imports / `.ts` extensions. Functionally identical; documented in Task 2 and Task 9.
