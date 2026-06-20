# Changelog

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
