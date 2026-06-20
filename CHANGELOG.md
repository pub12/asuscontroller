# Changelog

## 2026-06-21 — Device Sync vertical slice (fake-provider, overnight autonomous)
Built the entire device-sync vertical against a deterministic FakeRouterProvider — fake router →
recurring sync job → app_devices → APIs → Explore Devices screen. Zero live router/NextDNS traffic
(ROUTER_PROVIDER=fake throughout); every phase verified independently (tsc + next build clean, unauth
envelopes, worker + seed smokes) before commit.

- **Env & config:** ROUTER_PROVIDER / SYNC_INTERVAL_SEC typed env + accessors (getRouterProviderMode,
  getSyncIntervalSec); `npm run doctor` validates both; .env.example updated.
- **RouterProvider + factory:** deterministic FakeRouterProvider (10 devices across bands; goOffline/
  goOnline/addDevice/removeDevice sim hooks; node-importable — type-only imports, no server-only).
  getRouterProvider() factory lazy-loads AsusWrtProvider only when ROUTER_PROVIDER=asus.
- **Sync core:** pure `runDeviceSync(adapter, provider, nowIso, {intervalSec})` → upsert app_devices,
  immediate offline, capped elapsed-minute presence accrual, new-device detect (D4/D5 semantics).
  Self-contained `/api/sync-test` lifecycle proof + `sync_test` autotest scenario (8 flags green).
- **Worker:** standalone `scripts/worker.mjs` (`npm run worker`) — hazo_jobs scheduler+worker, idempotent
  find-or-create netwarden.sync schedule, boot-time one-shot, refuses ROUTER_PROVIDER=asus (exit 1).
- **Device APIs:** GET /api/devices (devices+groups), PATCH /api/devices/[id] (field-ownership enforced —
  only friendly_name/icon/notes/primary_group_id), POST /api/devices/[id]/acknowledge; in ALL_ROUTES.
- **Explore → Devices screen:** HazoUiTable (search, status chips, group badge), New-pill acknowledge,
  edit dialog (PATCH), EmptyState/Skeleton, Devices|Groups toggle; HazoUiToaster mounted.
- **Sync ops + Settings:** POST /api/sync/run (superadmin, inline) + GET /api/sync/status (from hazo_jobs);
  Settings Router & Sync section with provider/interval/last-run + Run-sync-now.
- **Dev seed:** demo groups (Kids, IoT) idempotent in scripts/seed.mjs so group badges render.
- **Docs:** feasibility report non-hardware sections finalized (§6 confirmed contracts); §§1-4 (live
  router/telemetry) still pending the supervised spike.
- **Notable:** fixed AsusWrtProvider import suffixes (.js → extensionless) — now that an App Route reaches
  getRouterProvider(), Next bundles the lazy AsusWrt import and Turbopack can't resolve .js→.ts.
- **Still open:** live AsusWrt productionisation + reboot-survival (hardware-blocked); telemetry provider
  undecided (NextDNS not set up).

## 2026-06-20 — Foundations build + feasibility contracts (overnight autonomous)
Built NetWarden as an external consuming app of the published hazo_* packages. All work verified
(next build + tsc clean, /autotest backends green, jobs spike PASS); no live router/NextDNS calls.

- **Phase 2 Foundations (8/8):** Next.js 16 App Router scaffold (src/app/, /autotest harness,
  Tailwind v4 @source); hazo_connect migrations for all 10 app_ tables; hazo_auth login + role
  resolution + env-var first-superadmin; hazo_api foundation (ok/fail envelopes, Zod→OpenAPI 3.1 +
  Swagger UI, withRequestContext, in-memory rate limiting).
- **Phase 3 Smalls:** typed hazo_env/config + `npm run doctor`; hazo_secure credential store +
  security headers + .env.example; mobile app shell — bottom nav (Explore/Schedules/Analytics/Admin),
  superadmin-only Settings (403 stub), Edge login-redirect middleware (matcher excludes /autotest +
  /api/* so the harness stays reachable).
- **Phase 1 contracts (items 4–6 done):** scripts/spike-jobs.mjs proves hazo_jobs persistence +
  re-arm across a real child-process restart; auth/connect/secure contracts green via fetch-based
  self-contained autotests (auth-test 5/5, settings-gate 2/2, schema-test, secret-test).
- **Phase 5 staged (written, NOT run):** RouterProvider + AsusWrtProvider draft (stock ASUSWRT
  appGet.cgi/applyapp.cgi); scripts/spike-router.mjs (guarded — flagless = banner + exit, zero
  network); TelemetryProvider + NextDnsProvider stub; docs/phase1-feasibility-report.md skeleton.
- **Open items:** live router read/write + reboot-survival unproven (need hardware + supervised
  session); telemetry provider undecided (NextDNS not set up) → Phase 8 blocked; user must place
  .env from .env.example for live auth.
- **Notable deviations:** hazo_ui ^4.3.1 / hazo_audit ^2.1.1 (spec typos corrected to published);
  hazo_auth schema read from dist (no consumer SQL shipped); in-memory rate-limit store (DB store
  wants a raw adapter); hazo_jobs needs a raw {raw()} adapter branching on better-sqlite3 stmt.reader.

## 2026-06-20 — Project initialized
- Created master_plan.md, CHANGELOG.md, DECISIONS.md from PRD v2 (design/netwarden_PRD_v2.md).
- PRD mode; phase breakdown mirrors PRD §16 (Phase 1 feasibility spike + Phases 2–10 + Backlog).
- 58 tasks recorded, all not-started. No application code exists yet.
- Redesigned screens in design/screens/ adopted as UI reference; they resolve the v1 scope
  conflicts previously noted in design/stitch-screens-review.md.
