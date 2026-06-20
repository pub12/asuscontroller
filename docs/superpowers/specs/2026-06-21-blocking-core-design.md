# Blocking Core — Design Spec (Phase 4)

> Persisted from the approved overnight-build handoff `prancy-dreaming-matsumoto.md`
> (`/hz_big_build` → `hz_build_fresh`). Date: 2026-06-21.

## Context

NetWarden's core verb is **control** (block/unblock a device's internet). Phase 3 shipped the
full device-sync vertical against a `FakeRouterProvider`, and in a prior session the live ASUS
read path was proven (34 real devices loaded from 192.168.50.1).

This build delivers **Phase 4 Blocking Core** end-to-end: block/unblock service → state +
reconcile → audit → drift reconcile in sync → UI (Devices action + Device Detail screen),
built and verified **fake-first** (the established D1 pattern), then exercised once against the
**real router on a single designated test device** with a short auto-restore fail-safe.

Reality already in place:
- `app_block_state` already exists in `migrations/0001_init.sql` (`device_id, is_blocked,
  blocked_by, blocked_at, reason, scheduled_unblock_at, unblock_job_id, router_synced`). No core migration needed.
- `RouterProvider.setInternetAccess(mac, enabled): Promise<AccessResult>` is in the interface
  (`src/server/router/RouterProvider.ts`); Fake stubs it, `AsusWrtProvider` drafts it.
- `runDeviceSync` (`src/server/sync/runDeviceSync.ts`) has a clean hook between the online-upsert
  loop and the offline pass for drift reconcile.
- API pattern: `withRequestContext` + `ok`/`fail` + `resolveServerAuth()`/`isSuperadmin`.
  Service pattern: `createCrudService(getDb(), 'table')`.
- `hazo_state ^0.1.2` (CAS via `expectedVersion`+`ConflictError`, TTL via `expiresAt`) and
  `hazo_audit ^2.1.1` (`auditIntent` / `emitIntentEvent`; outbox→drain→`hazo_audit_intent`/`_field`)
  are installed but their migrations are not yet wired into seeding.
- Devices UI: `src/app/(app)/explore/DevicesScreen.tsx` — server page → client screen, mutate via
  `fetch()` + `router.refresh()` in a transition; `successToast`/`errorToast`, `Switch` available.
  Status chip is online/offline only (no Blocked indicator yet). No Device Detail route exists.

## Settled decisions (from grilling)

| # | Decision | Choice |
|---|---|---|
| 1 | Headliner | Phase 4 Blocking Core, full vertical, **with** bounded live write |
| 2 | Reconcile state | **Full `hazo_state` CAS + TTL** desired-state marker (alongside `app_block_state`) |
| 3 | Audit | **Full `hazo_audit` outbox**; drain **folded into `scripts/worker.mjs`** |
| 4 | Block UI | Devices-screen action + Blocked badge **and** the Device Detail screen |
| 5 | Live blast radius | **One device only**: `Tablet-kitchen` `DC:BD:7A:D6:2F:02` |
| 6 | Reboot-survival | **Skip** unattended (leave open in ledger) |
| 7 | Auto-restore | **Yes** — live test-block auto-unblocks; **TTL = 5 min** (human-used device) |
| 8 | Detail telemetry sections | Toggle + presence + **audit-backed** activity timeline; top-domains = empty state |
| 9 | Block semantics | **Online-only** blocking; idempotent (re-block = no-op success) |
| 10 | Authorization | **Superadmin-only** (Phase 5 adds grants) |

## Scope (in)

1. **Block/unblock service** (`src/server/devices/blockService.ts`) — writes `app_block_state`,
   maintains a `hazo_state` desired-state marker with CAS+TTL, emits a `hazo_audit` intent per
   mutation, and calls `provider.setInternetAccess(mac, enabled)`.
2. **API**: `POST /api/devices/[id]/block`, `POST /api/devices/[id]/unblock` — superadmin-only,
   online-only validation, idempotent, `ok`/`fail` envelopes.
3. **Provider block simulation**: `FakeRouterProvider` tracks per-MAC blocked state, implements
   `setInternetAccess`, and a new `getBlockState(mac)`; interface gains optional `getBlockState`.
   `AsusWrtProvider.getBlockState` is **best-effort** (stock firmware may not report it cleanly).
4. **Drift reconcile** in `runDeviceSync` — compare intended (`app_block_state.is_blocked`) vs
   router actual (`getBlockState`, best-effort); re-apply intended on drift / unknown; update
   `router_synced`. Audit a reconcile intent when it re-applies.
5. **Audit infra**: wire `hazo_audit` + `hazo_state` migrations into seeding; fold the
   outbox **drain** into `scripts/worker.mjs`'s existing tick.
6. **UI — Devices screen**: per-row block/unblock action + a distinct **Blocked** badge (derived
   via `LEFT JOIN app_block_state`), `router.refresh()` + toast on success.
7. **UI — Device Detail** (`/app/(app)/explore/[id]`): header (name + online/offline + Blocked),
   **access toggle** (calls block API), **time-on-device** (sum `app_device_presence`),
   **recent-activity timeline** (from `hazo_audit_intent`/`_field` for this device), top-domains
   **empty state** ("telemetry not configured").
8. **Bounded live test** (gated step): block `Tablet-kitchen` via the real router → verify access
   cut → unblock → 5-min TTL fail-safe. Skips gracefully (logs) if the device is offline at run time.

## Non-goals (explicitly out)

- **No reboot of the real router**; reboot-survival remains an open ledger item.
- **No live blocking of any device other than `DC:BD:7A:D6:2F:02`.**
- **No timers/schedules UI** (the block-with-timer modal + Schedules screen are Phase 7); the
  `scheduled_unblock_at`/`unblock_job_id` columns are used only for the live-test auto-restore.
- **No group block-all** (Phase 6). **No grants/request workflow** (Phase 5) — superadmin-only.
- **No per-domain blocking** (Backlog). **No real top-domains data** (Phase 8 telemetry).

## Data model

- No new table for the core (`app_block_state` exists). New migrations only **register**
  `hazo_state` + `hazo_audit`'s own tables (their canonical SQLite DDL).
- `hazo_state` key shape: `block:<device_id>` → `{ blocked: boolean }`, written with
  `expectedVersion` (CAS) and `expiresAt` only for transient reconcile markers; `ConflictError`
  ⇒ re-read and retry (guards double-apply).
- Blocked status is **derived** (JOIN), never stored on `app_devices` (preserves the D5
  field-ownership split: sync owns router fields, this never clobbers them).

## API surface

| Route | Method | Auth | Body | Behavior |
|---|---|---|---|---|
| `/api/devices/[id]/block` | POST | superadmin | `{ reason?: string }` | 404 if no device; `VALIDATION_FAILED` if offline; idempotent; writes state, marker, audit; calls provider |
| `/api/devices/[id]/unblock` | POST | superadmin | `{}` | 404 if no device; idempotent; clears state, marker, audit; calls provider |

Errors reuse existing codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`.

## Edge / error states

- **Offline device** → block rejected (`VALIDATION_FAILED`, "device offline"). (Decision 9.)
- **Re-block / re-unblock** → no-op success (idempotent).
- **Provider call fails** → record intent in `app_block_state` with `router_synced = 0`; surface
  partial result; next sync reconcile retries. UI toast shows "saved, applying…".
- **`getBlockState` unknown** (stock ASUS) → reconcile treats as drift and re-applies intended.
- **Live test device offline at run time** → skip live exec, log + flag (do not substitute another MAC).

## Interactions with existing features

- Sync (`runDeviceSync`) gains the reconcile pass; must not regress D4 presence / D5 ownership.
- Devices screen + server page (`listDevicesAndGroups`) extend to carry block state via JOIN.
- `worker.mjs` gains an audit-outbox drain on its existing 60s tick (no new process).

## New ledger rows (record in master_plan.md)

- **D6** — Live router **read** path proven (34 devices); Phase 3 read productionised.
- **D7** — Blocking core built fake-first; live **write** exec bounded to one designated test MAC
  with 5-min auto-restore; reboot-survival still open.
- **D8** — `hazo_state` adopted for block desired-state CAS/TTL marker (vs simple flag).
- **D9** — Full `hazo_audit` outbox + drain folded into `worker.mjs`.
- **Trade-off** — `getBlockState` on stock ASUS unverified ⇒ reconcile re-applies intended on unknown drift.
