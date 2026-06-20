# NetWarden — Implementation Plan: Foundations + Staged Spike

Prereqs: this is NOT a git repo yet → **git init** first. Commit per item (boundaries below).
Run the dev server via scripts/next.mjs (never `next dev` directly). HAZO_ENV=development.
Each item's DoD: `next build` passes + typecheck/lint clean + its /autotest case green + the noted smoke.

### Step 0 — Docs + repo init  [commit: chore: init repo + handoff docs]
- git init; add .gitignore (node_modules, .next, *.sqlite, .env*, !.env.example).
- Write docs/netwarden-spec.md and docs/netwarden-impl-plan.md from the embedded artifacts.

### HEADLINER — Phase 2 Foundations spine (ordered)

1. **App scaffold**  [feat: scaffold next app on hazo workspace standard]
   - package.json (Next ^16, React 19, TS) + hazo runtime deps + overrides (tailwind 4.2.4, zod 4.4.3).
   - next.config.js: transpilePackages:[hazo_core,hazo_ui,hazo_auth,hazo_api,hazo_connect,hazo_jobs,
     hazo_env,hazo_config,hazo_logs,hazo_secure,hazo_state,hazo_audit]; serverExternalPackages:
     [better-sqlite3,sql.js,@napi-rs/canvas]; turbopack.resolveAlias hazo_debug→stub; webpack server externals.
   - postcss.config.mjs (@tailwindcss/postcss); src/app/globals.css with @import "tailwindcss";
     @import "tw-animate-css"; one @source "../../node_modules/hazo_*/dist" per used package.
   - src/app/layout.tsx wraps children in HazoContextProvider (hazo_ui).
   - scripts/next.mjs launcher; src/app/autotest/page.tsx (AutoTestProvider pkg="netwarden" + AutoTestRunner).
   - DoD: app boots via scripts/next.mjs; / renders; /autotest loads empty harness; build passes.

2. **Full-schema migrations**  [feat: hazo_connect migrations for all app_ tables]
   - migrations/ with one set creating all 10 app_* tables (schema in spec); SQLite dev DB.
   - hazo_connect createCrudService services for each table (or the workspace-standard setup entry).
   - DoD: migrate runs idempotently on a fresh DB; a /autotest case asserts every table exists + a
     round-trip insert/select on app_devices.

3. **hazo_auth wired**  [feat: auth login, roles, env-var first-superadmin]
   - hazo_auth config (.ini via hazo_config/hazo_core loadConfig); appId set.
   - Server session helper resolves subject+roles; first-superadmin via SUPERADMIN_EMAIL (idempotent).
   - Unauthed pages redirect to login.
   - DoD: login flow reachable; /autotest case asserts role resolution + first-superadmin grant logic
     (using hazo_testing auth factories); non-superadmin denied Settings.

4. **hazo_api foundation**  [feat: api envelopes, openapi, rate limit, example routes]
   - ok/fail envelopes + error codes, withRequestContext, rate limiting, Zod→OpenAPI 3.1 + Swagger UI.
   - GET /api/health (unauthed), GET /api/me (authed → subject+roles).
   - DoD: /api/health returns ok envelope; /api/me 401s unauthed and returns roles authed; Swagger UI
     renders; /autotest case via hazo_testing apiTestClient covers both routes.

### SMALLS (additive leaves; each its own commit)

- [ ] **hazo_env / hazo_config + doctor**  [feat: typed env + config doctor]
  - Typed env names, per-env DB/file/secret config, doctor CLI. DoD: doctor passes; bad env reported.
- [ ] **hazo_secure wiring + .env.example**  [feat: secure credential store + env example]
  - Wire hazo_secure for router host/user/pass + telemetry key + security headers. Generate
    .env.example: HAZO_ENV, SUPERADMIN_EMAIL, ROUTER_HOST, ROUTER_USER, ROUTER_PASS, SPIKE_TEST_MAC,
    NEXTDNS_API_KEY (commented "TODO: telemetry provider undecided"). DoD: store/read a secret in a
    Next server context in a /autotest case; secrets never reach client bundle.
- [ ] **Login screen**  [feat: hazo_auth login]
  - Use hazo_auth built-in login. DoD: unauthed → login; successful login → app shell.
- [ ] **Settings skeleton + bottom nav**  [feat: shell stubs + bottom nav]
  - Bottom nav (Explore·Schedules·Analytics·Admin) + 4 stub routes; superadmin-only Settings stub
    (router/telemetry/polling placeholders). DoD: nav routes render; Settings 403s for non-superadmin.

### NON-HARDWARE CONTRACT CHECKS (Phase 1 items 4–6; runnable)  [test: phase1 hazo contract checks]
- [ ] **hazo_jobs persistence/re-arm** — scripts/spike-jobs.mjs: register handler, schedule one-shot +
  recurring, kill the worker process, restart, assert the job re-arms and fires; record method
  signatures + recurrence format + retry semantics into the feasibility report. (Pure software — runs.)
- [ ] **hazo_auth role resolution** — /autotest case: resolve subject+roles server-side; scoped-role
  strings; first-superadmin provisioning. Lock signatures in the report.
- [ ] **hazo_connect + hazo_secure smoke** — /autotest case via hazo_testing: app_ table CRUD + secret
  store/retrieve in Next server context. Lock signatures in the report.

### STAGED — write, do NOT run  [chore: stage router spike + telemetry stub (unrun)]
- [ ] src/server/router/{RouterProvider.ts (interface), AsusWrtProvider.ts (draft, server-only, stock
  appGet.cgi get_clientlist + applyapp.cgi block/unblock, login→asus_token)}.
- [ ] scripts/spike-router.mjs — reads .env; login→token (measure expiry), get_clientlist (read),
  block+unblock SPIKE_TEST_MAC (write). **Header comment: DO NOT RUN UNATTENDED — supervised only.**
- [ ] src/server/telemetry/{TelemetryProvider.ts (interface), NextDnsProvider.ts (stub returning
  "not configured")}.
- [ ] docs/phase1-feasibility-report.md skeleton: read/write/reboot/telemetry sections + confirmed-
  contracts appendix (§6) + go/no-go — contract sections filled by the runnable checks; hardware +
  telemetry sections left "PENDING (staged/decision needed)".

### Tracker updates (last commit)  [docs: update master_plan/CHANGELOG/DECISIONS]
- master_plan.md: mark Phase 2 tasks [x] (8); Phase 1 items 4–6 [x]; items 1,2,3,7 [-] partial with a
  note ("staged/blocked"); refresh dashboard + Phase Map counts (keep both in sync).
- CHANGELOG.md: new dated entry summarizing the build.
- DECISIONS.md: add "External consuming app", "Full schema upfront", "Env-var first-superadmin",
  "Telemetry provider deferred (NextDNS not set up)".
- Trade-off ledger: add the rows below.

## New trade-off ledger rows
| Compromise | Ideal | Interim | Long-term fix | Trigger to revisit |
|---|---|---|---|---|
| Telemetry provider undecided (NextDNS not set up; stock firmware) | Clean per-device domain telemetry | Provider stubbed "not configured"; Phase 8 blocked | Choose NextDNS (preferred) / Merlin / stock history | Before any telemetry work |
| Live spike staged, not run | Contracts proven against real router | Foundations + non-hardware contracts proven; scripts ready | Supervised spike session | Router + guinea-pig MAC available with a human |
| Reboot-survival unproven | Confirmed block persists across reboot | Documented open item | Run during supervised session | Drives reconcile design in Phase 4 |

## Pause / review flags (for the unattended builder)
- **Hard stop:** never execute scripts/spike-router.mjs or any live router/NextDNS call. Stage only.
- If `next build` cannot pass after reasonable effort on the scaffold, **stop and report** (do not
  paper over with `// @ts-nocheck` or disabled lint).
- If a hazo package's real API diverges from the spec's assumed signatures, **stop and report** the
  mismatch rather than guessing (esp. hazo_api withRequestContext, hazo_auth session helper,
  hazo_jobs scheduleRecurring).
