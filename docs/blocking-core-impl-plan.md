# Blocking Core — Implementation Plan (Phase 4)

> Persisted from the approved overnight-build handoff `prancy-dreaming-matsumoto.md`.
> Companion to `docs/superpowers/specs/2026-06-21-blocking-core-design.md`. Date: 2026-06-21.

Maps to master_plan Phase 4 (Block API, State & Reconcile ×2, Audit, Device Detail), plus
Phase 1 router read/write and Phase 3 RouterProvider markers.

**Build order (commit boundaries).** Steps 1–7 + 9 are fully autonomous (fake-first, zero live
traffic). Step 8 is the **only** step that touches the real network.

1. **Audit/state infra** — register `hazo_audit` + `hazo_state` SQLite tables in the seeded DB;
   add an autotest asserting the new tables exist. *DoD:* `node scripts/seed.mjs` applies them;
   tables present; build green.
2. **Provider block sim** — `FakeRouterProvider`: per-MAC blocked `Map`, real `setInternetAccess`,
   `getBlockState(mac)`. Add optional `getBlockState` to `RouterProvider`; `AsusWrtProvider`
   best-effort impl. *DoD:* unit/autotest flips + reads block state via Fake.
3. **blockService** — `src/server/devices/blockService.ts`: `blockDevice(id, {actor, reason})`,
   `unblockDevice(id, {actor})`. Writes `app_block_state`, `hazo_state` CAS marker, `auditIntent`,
   calls provider. Online-only guard, idempotent. *DoD:* autotest covers block/unblock/idempotency/offline-reject.
4. **API routes** — `block`/`unblock` route handlers per the `withRequestContext`+`ok`/`fail`
   pattern, superadmin gating. *DoD:* fetch-based autotests green against fake.
5. **Drift reconcile** — hook into `runDeviceSync` between online-upsert and offline pass; re-apply
   on drift/unknown; update `router_synced`; audit re-applies. **Fold audit-outbox drain into
   `worker.mjs`.** *DoD:* reconcile autotest (set drift via Fake → sync re-applies); presence/ownership unregressed.
6. **Devices UI** — block/unblock row action + Blocked badge (JOIN in `listDevicesAndGroups`);
   `router.refresh()` + toast. *DoD:* manual smoke; blocked device shows badge; toggle works.
7. **Device Detail screen** — `/app/(app)/explore/[id]/page.tsx` (server) + `DeviceDetailScreen.tsx`
   (client): header, access toggle, time-on-device, audit-backed activity timeline
   (`getDeviceActivity(deviceId)` over `hazo_audit_intent`/`_field`), top-domains empty state.
   *DoD:* navigable from Devices row; toggle blocks/unblocks; timeline shows the audit entries.
8. **⏸ LIVE TEST (only real-network step)** — `scripts/live-block-test.mjs`: with
   `ROUTER_PROVIDER=asus`, confirm `Tablet-kitchen` (`DC:BD:7A:D6:2F:02`) is online → block →
   verify access cut (re-login + `getBlockState`/clientlist) → unblock → assert restored. Set a
   **5-min** `scheduled_unblock_at` fail-safe before blocking. **Skip + log** if offline.
   *Flag:* this is the single outward-facing action; everything else is reversible/local.
9. **Smalls** (independent, do anytime):
   - [ ] **master_plan + ledger reconciliation** — mark Phase 1 router-read proven, Phase 3 read
     productionised; add D6–D9 + the `getBlockState` trade-off; refresh dashboard counts.
   - [ ] **Settings sync/router status panel** (read-only) — provider mode (live/fake), last sync, device count.
   - [ ] **Devices empty state** — friendly "no devices yet / run a sync" state.

**New deps:** none (all packages installed). **DDL:** none for the core; only registration of the
existing `hazo_state`/`hazo_audit` SQLite tables.

**Global definition of done:** `npm run build` (typecheck) passes; autotest suite green against
`FakeRouterProvider`; manual smoke of block → badge → Detail → unblock; live test (step 8)
either passes on `Tablet-kitchen` or is cleanly skipped-and-logged; master_plan/ledger updated;
work committed on a branch (not directly on `main`).

## Risks / pause-for-review

- **Step 8 live write** is the only unattended real-network action — bounded to one MAC, verify-
  then-unblock in seconds, 5-min TTL fail-safe.
- **`getBlockState` on stock ASUS is unverified** — step 8 doubles as the probe for how (whether)
  the firmware reports block state; reconcile is designed to degrade safely if it can't.
- **Scope is ~2–3 L's**, not one. If the session runs short, ship in build-order; steps 6–7 (UI)
  and 9 (smalls) are the natural trim line.

## Implementation note (deviation from literal step 1)

The plan's step 1 says "`runMigrations` for each `node_modules/<pkg>/migrations`". That does not
work directly on SQLite: `hazo_state/migrations/` ships both a Postgres file and a SQLite variant
(running the dir runs both → the Postgres file fails), and `hazo_audit/migrations/001_init.sql`
has the Postgres DDL active with the SQLite DDL commented out. The package itself instructs
"uncomment when running against SQLite". We therefore register the canonical SQLite DDL via a
new app migration (`migrations/0003_*.sql`), picked up by the existing
`runMigrations(adapter, { directory: 'migrations' })` call in `seed.mjs` and by the hermetic
temp-DB autotest harness. Same end state (tables created, verified by autotest); no Postgres DDL
is ever run against SQLite.
