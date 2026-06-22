# DarylWeb — Build Spec: Foundations + Staged Spike

## Purpose
Stand up the DarylWeb application substrate on the hazo_* workspace standard so all later phases
have a place to live, and stage (without running) the live-hardware feasibility spike.

## Scope
IN: Next.js App Router scaffold, full app_* schema via hazo_connect migrations, hazo_auth login +
roles + env-var first-superadmin, hazo_api envelope/OpenAPI/rate-limit foundation with one authed
example route, hazo_env/config + doctor, hazo_secure credential wiring, hazo_ui shell stubs (Login,
Settings, bottom nav), /autotest harness, and three non-hardware contract checks.

OUT (non-goals): device sync, blocking, groups, schedules, telemetry ingest, analytics, permissions
workflow, images, notifications, PWA, desktop-responsive polish, and ANY live network/router call.

STAGED (delivered as code, not executed): AsusWrtProvider draft + router spike script,
TelemetryProvider/NextDnsProvider stub, feasibility-report skeleton, .env.example.

## Platform / stack (match the ecosystem; ref 12.kinstripe + hazo_admin/test-app)
- Next.js ^16 (App Router), React 19, TypeScript 5, Tailwind v4 (CSS-config, no tailwind.config.ts).
- DB: SQLite via hazo_connect for dev (better-sqlite3); dual SQLite/Postgres conventions preserved.
- Overrides for consistency: tailwindcss@4.2.4, zod@4.4.3, clsx@^2.1.1, postcss@^8.4.49.
- Env convention: HAZO_ENV (development for the build).

## hazo dependencies (npm, published)
Runtime: hazo_core ^1.2.0, hazo_connect ^3.8.0, hazo_auth ^10.4.1, hazo_api ^2.5.0, hazo_jobs
^0.14.0, hazo_secure ^1.3.0, hazo_state ^0.1.2, hazo_audit ^2.1.2, hazo_env ^0.3.0,
hazo_config ^2.3.0, hazo_logs ^2.x, hazo_ui ^4.4.0.
Dev: hazo_testing ^0.3.1.
(Deferred to later phases — do not install yet unless a foundation file imports them:
hazo_files, hazo_images, hazo_dataviz, hazo_admin, hazo_notify, hazo_ihelp, hazo_umetrics,
hazo_feedback, hazo_pdf.)

## Data model — full schema (PRD §8), one migration set, all via hazo_connect createCrudService
- app_devices(id, mac UNIQUE NOT NULL, hostname, friendly_name, vendor, icon, notes, current_ip,
  last_band, status[online|offline|blocked], is_new, first_seen, last_seen, primary_group_id FK app_groups.id)
- app_groups(id, name NOT NULL, description, type[person|generic], image_file_id, color, created_by, created_at)
- app_group_members(group_id, device_id, added_by, added_at) PK(group_id, device_id)
- app_block_state(device_id PK, is_blocked, blocked_by, blocked_at, reason[manual|scheduled|group:{id}],
  scheduled_unblock_at, unblock_job_id, router_synced)
- app_schedules(id, target_type[device|group], target_id, action[block|unblock], run_at, cron, job_id,
  status[active|done|cancelled], created_by, created_at)
- app_user_grants(id, subject, capability, scope_type[global|group], scope_id, status[active|revoked],
  granted_by, granted_at) UNIQUE(subject, capability, scope_type, scope_id)
- app_access_requests(id, subject, capability, scope_type, scope_id, note, status[pending|approved|declined],
  decided_by, decided_at, created_at)
- app_domain_events(id, device_id NOT NULL, domain NOT NULL, ts NOT NULL) INDEX(device_id, domain, ts)
- app_domain_rollup_daily(device_id, domain, day, query_count, first_seen, last_seen, est_active_minutes)
  PK(device_id, domain, day)
- app_device_presence(device_id, day, connected_minutes) PK(device_id, day)
Secrets → hazo_secure; audit → hazo_audit; images → hazo_files; volatile reconcile markers → hazo_state;
job metadata → hazo_jobs. (No app_block_audit table — hazo_audit owns it.)

## Auth
- Role strings: darylweb:{appId}:superadmin, darylweb:{appId}:user.
- Server resolution via hazo_api withRequestContext + hazo_auth server session helper.
- First-superadmin: on login, if subject email === SUPERADMIN_EMAIL and no superadmin exists, grant
  darylweb:{appId}:superadmin. Idempotent.
- Unauthenticated → redirect to hazo_auth login.

## API surface (foundation only)
- ok/fail envelopes + error codes, Zod→OpenAPI 3.1 + Swagger UI, withRequestContext, rate limiting.
- Example routes proving the wiring: GET /api/health (unauthed ok envelope) and GET /api/me (authed;
  returns subject + roles). No device/group/block routes yet.

## UI / behavior
- Mobile-first. HazoContextProvider wraps the app. Bottom nav: Explore · Schedules · Analytics · Admin
  (Explore default). Each nav target is a minimal hazo_ui stub page ("Coming in Phase N").
- Login = hazo_auth built-in flow. Settings = superadmin-only stub (router/telemetry/polling placeholders).
- Design language for stubs: indigo primary, teal accent, green/gray/red status colors (per design/).

## Edge / error / empty states
- No DB yet on first boot → migrations run idempotently on setup; /autotest reports DB health.
- Not-authenticated → redirect to login. Non-superadmin hitting Settings/Admin → 403 stub.
- Staged scripts run with missing .env → fail fast with a clear "set these vars" message; never hang.
- Telemetry stub → returns a typed "provider not configured" result, never throws.

## Interactions with existing features
- None yet (greenfield). Establishes the contracts every later phase consumes.

## Decisions settled (see DECISIONS.md updates)
- External consuming app (npm), not a workspace member.
- Full schema migrated upfront despite most tables unused until later phases.
- Env-var first-superadmin. Telemetry provider deferred (open decision). Live spike staged.
