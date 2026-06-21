# Phase 7 Timers & Schedules — Implementation Plan

**Conventions to follow (from code audit):** routes = `withRequestContext` + `ok/fail` + Zod +
`authorizeCapability` (`src/app/api/devices/[id]/block/route.ts`); services in `src/server/<area>/`;
migrations `migrations/NNNN_*.sql` idempotent; pure cores importable by `.mjs` worker (see
`runDeviceSync`); autotests via `registerScenario`/`assertEqual` in
`src/scenarios/netwarden_scenarios.ts` + a `/api/*-test` hermetic route; worker pattern in
`scripts/worker.mjs`. **All steps are fake-first — no hardware, fully unattended.**

### Step 0 — Materialize docs (commit: `docs: phase7 spec + impl plan`)
Create `docs/timers-schedules-spec.md` (the SPEC section above) and
`docs/timers-schedules-impl-plan.md` (this IMPLEMENTATION PLAN section).
**DoD:** both files exist, match this plan.

### Step 1 — Migration `0005_schedules.sql` (commit: `phase7: schedules migration`)
Add `label`, `window_id` to `app_schedules` (guarded per migration-runner semantics — verify first).
**DoD:** migration applies idempotently on a fresh + existing DB; `schema_roundtrip` autotest still green.

### Step 2 — Service core + pure fire fn (commit: `phase7: scheduleService + runScheduleFire`)
`src/server/schedules/scheduleService.ts`, `runScheduleFire.ts`, `tz.ts`. Wire the early-unblock hook
into `blockService`/`blockActions` unblock path.
**DoD:** unit-level autotest (Step 6) green; `tsc` clean.

### Step 3 — Worker handlers (commit: `phase7: worker block/unblock handlers`)
Extend `scripts/worker.mjs` `types` + handler switch to call `runScheduleFire` for
`netwarden.block`/`netwarden.unblock`; emit schedule-fired notify; drain audit. Document
`TZ=Australia/Sydney` for `npm run worker`.
**DoD:** `ROUTER_PROVIDER=fake TZ=Australia/Sydney node --conditions=react-server scripts/worker.mjs`
boots; a `*/1` recurring test schedule fires and flips block state.

### Step 4 — API routes (commit: `phase7: schedules API`)
`/api/schedules` (GET, POST), `/api/schedules/[id]` (PATCH, DELETE), `/api/schedules-test`. Register in
`src/lib/api_routes.ts`.
**DoD:** routes return correct envelopes; authz enforced; `requests`/`grants` autotests still green.

### Step 5 — UI: modal + Schedules screen (commit: `phase7: block-timer modal + Schedules screen`)
`BlockTimerModal` on Device Detail + Group Detail; replace Schedules placeholder with `SchedulesScreen`
(active timers / upcoming / recurring windows; edit·pause·cancel; capability-gated). Reference
`design/screens/screen copy 2.png`.
**⏸ PAUSE FOR REVIEW:** UI/UX is the one subjective surface — flag for a look before final commit
(everything else can run unattended).
**DoD:** `next build` passes; modal creates each kind; Schedules screen lists/edits/cancels.

### Step 6 — Autotests (commit: `phase7: schedules autotests`)
Add to `netwarden_scenarios.ts` + `/api/schedules-test`: `schedule_timer`, `schedule_fire`,
`schedule_recurring` (create/pause/update/delete), `schedule_early_unblock`, `schedule_authz`,
`schedule_future_block`. Drive fires by calling `runScheduleFire` directly (don't wait on the
scheduler), FakeRouterProvider + temp DB.
**DoD:** all new scenarios green at `/autotest`; full suite still green.

### Smalls (after headliner; independent files)
- **S-a — master_plan reconcile** (commit: `docs: reconcile master_plan (phases 5/6/10-ops + 7)`):
  mark Phases 5, 6, Ops-slice-of-10, and Phase 7 done; fix Phase Map + dashboard via the recount
  commands; CHANGELOG entry; add ledger rows D10–D13.
  **DoD:** `grep -c "^- \[x\]"` matches the new dashboard total; Phase Map sums == checklist counts.
- **S-b — stale-copy sweep** (folded into Step 5 commit or standalone): confirm no remaining wrong
  "Phase 6/8" UI copy after the Schedules screen lands.
  **DoD:** grep for "coming in Phase" shows only intended placeholders (Analytics → Phase 8).
- **S-c — schedule-fired notify** (folded into Step 3): `notifyScheduleFired` in
  `src/server/notify/events.ts` + covered by `notify-events` autotest.
  **DoD:** `notify-events` autotest asserts the new mapping.

### Required DDL / deps
- DDL: `migrations/0005_schedules.sql` (additive). **No new npm deps** (hazo_jobs already installed).
- Env: worker should run with `TZ=Australia/Sydney`.

### Suggested commit boundaries
Step 0 → 1 → 2 → 3 → 4 → 5 (pause) → 6, then S-a (and S-b/S-c folded). One logical commit per step.

## Open risk (single)
- **Migration-runner idempotency for `ALTER ADD COLUMN`** — verify the runner is once-only before
  writing `0005`; if not, guard with `pragma table_info`. (Low risk; checked in Step 1.)
