# Phase 7 Timers & Schedules — Spec

## Goal
Let an authorized user block a device/group **now with an auto-unblock timer**, **at a future
time**, or on a **recurring window** (e.g. nightly 21:00→07:00), and manage all of it from a
Schedules screen. Built fake-first (FakeRouterProvider), hermetic autotests, no hardware.

## Non-goals / out of scope
- Per-domain / per-URL scheduling (Backlog DNS-layer item).
- Per-user timezones (fixed AEST).
- Staleness-skip for missed fires (fire-late accepted).
- Calendar/iCal import, holiday awareness, "snooze" UX.
- Continuous window-assert / locking against manual override (edge-triggered only).
- New auth infra — reuse the existing capability model + `authorizeCapability`.

## Data model
Reuse `app_schedules` + `app_block_state`. One additive migration: **`0005_schedules.sql`**.
- `app_schedules` (existing): `id, target_type(device|group), target_id, action(block|unblock),
  run_at(ISO, one-shot), cron(5-field, recurring), job_id(hazo job/schedule id), status, created_by, created_at`.
  - **Add `label TEXT`** (display name, e.g. "Bedtime").
  - **Add `window_id TEXT`** (groups the two rows of a recurring window: a block-cron row + an
    unblock-cron row share one `window_id`).
  - **`status` value set extended (no DDL):** `active | paused | done | cancelled`.
  - **Kind is derived:** `cron != null` → recurring; `run_at != null` → one-shot.
- `app_block_state` (existing, unchanged): an active auto-unblock timer sets `scheduled_unblock_at`
  + `unblock_job_id` for fast early-unblock cancellation.

> Migration note: SQLite `ALTER TABLE ADD COLUMN` is not `IF NOT EXISTS`. Confirm the migration
> runner is once-only (tracks applied files); if not, guard each ADD with a `pragma table_info`
> check. Verify against how `0001–0004` are applied before writing `0005`.

## Job types & handler (worker)
Add `netwarden.block` and `netwarden.unblock` to the worker `types` array + handler switch in
`scripts/worker.mjs`. Extract the fire logic into a **pure, importable** function so autotests can
call it directly (mirrors `runDeviceSync`):
`src/server/schedules/runScheduleFire.ts` → `runScheduleFire(adapter, provider, { targetType,
targetId, action, scheduleId })`:
- device → `runBlockAction` with a **system gate** (`{authorized:true, actorLabel:'schedule:<id>'}`),
  `action`; group → `groupBlockActions` block-all/unblock-all.
- one-shot row → `status='done'`; recurring row → leave `active`, stamp last-fired.
- emit schedule-fired ops-notify; drain audit (as the sync handler does).
- run inside `runWithAuditContext({actor_kind:'system', actor_label:'schedule:<id>'})`.

## Service layer — `src/server/schedules/scheduleService.ts`
- `createTimer({targetType,targetId, durationMin | untilISO, actor})` — block now (`runBlockAction`
  block) → `jobs.submit({type:'netwarden.unblock', runAt})` → set `app_block_state.unblock_job_id`
  + `scheduled_unblock_at` + insert `app_schedules` row (`action=unblock, run_at, job_id, status=active`).
- `createFutureBlock({targetType,targetId, action, atISO, actor})` — `jobs.submit({type, runAt})` +
  row.
- `createRecurring({targetType,targetId, action, cron, label?, windowId?, actor})` —
  `jobs.schedules.create({name,cron,type,payload})` + row (`cron`, `job_id=schedule.id`).
- `createWindow({targetType,targetId, blockCron, unblockCron, label?, actor})` — two `createRecurring`
  rows sharing a generated `window_id`.
- `updateSchedule(id, patch)` — recurring → `jobs.schedules.update(job_id, {cron?,enabled?,payload?})`;
  one-shot → `jobs.cancel(job_id)` + re-`submit` new `runAt`, update `job_id`; update row.
- `setEnabled(id, enabled)` — recurring → `jobs.schedules.update(job_id,{enabled})`; row
  `status=paused|active`.
- `cancelSchedule(id)` — one-shot → `jobs.cancel(job_id)`; recurring → `jobs.schedules.delete(job_id)`;
  row `status=cancelled`; if it was an active timer, clear `app_block_state.unblock_job_id`/`scheduled_unblock_at`.
- `listSchedules({targetType?, targetId?})` — read rows; enrich recurring with live `next_run_at`
  from `jobs.schedules.list()`; group windows by `window_id`.
- **Early-unblock hook:** in `blockService.unblockDevice` / `runBlockAction` unblock path, if the
  device has `unblock_job_id`, `jobs.cancel` it + mark its row `cancelled` + clear the columns (PRD §6.2).
- **TZ helper** `src/server/schedules/tz.ts` — convert AEST wall-time → absolute ISO instant for
  `until`/future inputs (use `Intl`/fixed Australia/Sydney; no new dep).

## API surface — `src/app/api/schedules/...`
All routes: `withRequestContext`, `resolveServerAuth`, `authorizeCapability`, `ok/fail`; register in
`src/lib/api_routes.ts` for OpenAPI.
| Method | Path | Body / params | Authz |
|---|---|---|---|
| GET | `/api/schedules` | `?targetType=&targetId=` (optional) | authenticated (view) |
| POST | `/api/schedules` | discriminated `kind`: `timer` `{durationMin\|untilISO}` · `future` `{action,atISO}` · `recurring` `{action,cron,label?}` · `window` `{blockCron,unblockCron,label?}` — all with `targetType,targetId` | `schedule.create` (scoped to target) |
| PATCH | `/api/schedules/[id]` | `{cron?,action?,run_at?,enabled?,label?}` | `schedule.cancel` |
| DELETE | `/api/schedules/[id]` | — | `schedule.cancel` |
| GET | `/api/schedules-test` | hermetic temp-DB test route | — |

## UI / behavior
- **`BlockTimerModal`** (`src/components/BlockTimerModal.tsx`, `hazo_ui`): segments **Now** /
  **For…** (15m·30m·1h·2h·custom mins) / **Until…** (time picker, AEST) / **Recurring** (block time
  + unblock time → window, or single action + friendly cron) + optional label. Submits to
  `/api/schedules` (or the existing block route for plain "Now"). Surfaced on **Device Detail** and
  **Group Detail**.
- **Explore list rows:** keep existing one-tap quick block/unblock (unchanged).
- **Schedules screen** (`src/app/(app)/schedules/page.tsx` + `SchedulesScreen.tsx`, replaces the
  "coming in Phase 6" placeholder): sections — **Active timers** (one-shot, countdown to `run_at`),
  **Upcoming** (future one-shots), **Recurring windows** (grouped by `window_id`; show block/unblock
  times + next run + enabled toggle). Each item: in-place **edit** (modal), **pause/enable**,
  **cancel**. Actions shown only when the viewer holds the capability (superadmin sees all). AEST shown
  on all times.

## Edge & error states
- **until-time already past today** → next occurrence (tomorrow) in AEST.
- **timer on an offline/blocked device** → reuse existing block-engine semantics (block is idempotent;
  group partial-failure capture already exists).
- **early manual unblock of an active timer** → cancels the pending unblock job + row.
- **cancel a job that's already running/terminal** → `jobs.cancel` returns `{cancelled:false,reason}`;
  surface gracefully, still mark row resolved.
- **worker offline past a fire** → fires late on restart (accepted); reconcile smooths state.
- **missing/invalid cron or duration** → `VALIDATION_FAILED`.
- **no capability** → `FORBIDDEN` (route) / hide action (UI).

## Interactions with existing features
- **Reconcile (Phase 4):** edge-triggered fires write `app_block_state`; reconcile already re-applies
  intended state and never auto-unblocks — no change needed.
- **Audit (Phase 4):** fires run under `runWithAuditContext` as system actor → existing outbox/drain.
- **Permissions (Phase 5):** reuse `authorizeCapability` + `schedule.create`/`schedule.cancel`.
- **Groups (Phase 6):** group schedules reuse `groupBlockActions` block-all/unblock-all.
- **Notify (Phase 10 S1/S2):** add a schedule-fired event to `src/server/notify/events.ts`.

## New trade-off ledger rows
- **D10 · Schedules = `app_schedules` + hazo_jobs** (one-shot `submit{runAt}`, recurring
  `schedules.create`); fire runs as **system actor**; **edge-triggered** state writes. Revisit if a
  continuous-assert window is needed.
- **D11 · Fixed AEST** for all schedule evaluation (worker `TZ` + create-time conversion). Revisit if
  multi-TZ households appear.
- **D12 · Fire-late on downtime** (hazo_jobs default; no staleness skip). Revisit if surprise late
  blocks are reported.
- **D13 · Recurring window = two linked rows** (block-cron + unblock-cron via `window_id`). Revisit if
  a first-class window entity is warranted.
