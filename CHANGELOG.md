# Changelog

## 2026-06-21 — Phase 8 — Telemetry vertical (domain insights, fake-first, overnight autonomous)
Built the full telemetry vertical fake-first: deterministic FakeTelemetryProvider → worker-pure ingest
core → darylweb.ingest schedule → per-device domain drill-down — all verified against fake data. Live
NextDnsProvider stays a not-configured stub pending the real-source decision (D14). tsc + next build
clean; ingest autotest + telemetry_ingest scenario green.

- **Migration 0006:** `app_domain_events.blocked` flag + `app_groups.monitoring_enabled` (DEFAULT 1);
  applied to the live darylweb.sqlite via the existing seed step.
- **TelemetryProvider factory:** `TELEMETRY_PROVIDER` / `TELEMETRY_INGEST_SEC` env + async provider
  factory; FakeTelemetryProvider default; NextDnsProvider lazy-loaded but still a not-configured stub
  — fake-provider-first per D14.
- **Deterministic FakeTelemetryProvider** (39 events / 10 devices / 4 blocked) and worker-pure
  `runTelemetryIngest` core (watermark + half-open `[from,to)` window + composite-PK pre-SELECT dedupe
  — D16); hermetic `/api/ingest-test` lifecycle proof + `telemetry_ingest` autotest scenario.
- **darylweb.ingest worker schedule:** idempotent find-or-create, default `*/5` cron; boot one-shot;
  verified live (inserted 39, re-run fetched 1 / inserted 0 / skipped 1); telemetry-gap ops alert
  fires on `configured:false`.
- **Per-device domain drill-down** on Device Detail: top domains + recent lookups + Today/7d toggle +
  empty states; "Today" = UTC day shared with the presence card above it (D15).
- **Per-row quick timer** on Devices screen: Clock button per row opens a `QuickTimerDialog` (quick
  picks + active `TimerBadge` countdown + cancel); entry point separate from the Device Detail
  `BlockTimerModal`.
- **Per-group privacy monitoring flag** with read-side gate (D17): superadmin toggle on the Group
  detail page; `COALESCE(g.monitoring_enabled,1)` check in the drill-down read fn returns an empty
  monitoring-off result before reading any events; null/no-group defaults to on.
- **Decisions:** D14–D17 appended to the master_plan trade-off ledger; D6–D13 backfilled as full
  prose entries in DECISIONS.md.

## 2026-06-21 — Phase 7 — Timers & Schedules (fake-first, overnight autonomous) + master_plan reconcile
Built the full Timers & Schedules vertical fake-first: one-shot timers, future-dated one-shots, and
recurring block/unblock windows — all verified against FakeRouterProvider. Worker fires darylweb.block/
unblock as a SYSTEM actor (audited as schedule-initiated). tsc + next build clean; all_ok autotests green.
master_plan.md reconciled: Phases 5, 6, 7 and Phase 10 Ops marked done; dashboard and Phase Map updated.

- **Migration 0005:** app_schedules label column + window_id (links block-cron and unblock-cron pairs).
- **Worker-pure schedule engine:** runScheduleFire + scheduleService; AEST timezone (TZ=Australia/Sydney);
  jobsAdapter bridge connects hazo_jobs to the schedule service; all evaluation runs in the worker process.
- **System-actor fires:** worker fires darylweb.block/unblock as a SYSTEM actor; mutations audited as
  schedule-initiated (not re-checked per fire); notifyScheduleFired hook called on each fire.
- **Schedules HTTP API:** list/create/update/cancel endpoints; discriminated kind (one-shot vs recurring
  window); schedule.create and schedule.cancel capability checks via the grants guard.
- **BlockTimerModal + SchedulesScreen UI:** quick picks + until-time + recurring toggles (REVIEW-pending;
  HazoUiDialog used; design bottom-sheet still open); SchedulesScreen lists active and upcoming schedules.
- **Autotests:** 6 schedule autotests added; includes notify-fired assertion; all_ok green.
- **master_plan reconcile:** Phases 5/6/7 all checklist items flipped to [x]; Phase 10 Ops items flipped
  to [x]; Progress dashboard recounted (Done=36, In-progress=3, Not-started=19, Total=58, 62%); Phase Map
  updated to done for Phases 5/6/7 and ops-slice-done for Phase 10. Trade-off ledger rows **D10–D13**
  appended to the master_plan ledger (D10 schedules=app_schedules+hazo_jobs/system-actor/edge-triggered;
  D11 fixed AEST; D12 fire-late on downtime; D13 recurring window = two linked rows via window_id).
- **Docs note:** DECISIONS.md (the prose mirror) lags the canonical master_plan ledger — it only carries
  D1–D5; D6–D13 live as rows in the master_plan trade-off ledger. Backfilling D6–D13 as DECISIONS.md
  prose is a separate, non-blocking docs cleanup.

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
  find-or-create darylweb.sync schedule, boot-time one-shot, refuses ROUTER_PROVIDER=asus (exit 1).
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
Built DarylWeb as an external consuming app of the published hazo_* packages. All work verified
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
- Created master_plan.md, CHANGELOG.md, DECISIONS.md from PRD v2 (design/darylweb_PRD_v2.md).
- PRD mode; phase breakdown mirrors PRD §16 (Phase 1 feasibility spike + Phases 2–10 + Backlog).
- 58 tasks recorded, all not-started. No application code exists yet.
- Redesigned screens in design/screens/ adopted as UI reference; they resolve the v1 scope
  conflicts previously noted in design/stitch-screens-review.md.
