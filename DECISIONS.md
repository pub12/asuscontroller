# Decisions

### 2026-06-20 — Reuse the hazo_* ecosystem over bespoke infrastructure
NetWarden is a consuming app: identity, persistence, jobs, audit, secrets, files, charts,
admin shell, UI all come from existing hazo_* packages. Own code is limited to RouterProvider,
TelemetryProvider, block/reconcile logic, and NetWarden screens.

### 2026-06-20 — Feasibility-first phasing with a hard go/no-go gate
Phase 1 is a throwaway/thin spike proving the unofficial ASUSWRT control path, telemetry
attribution, and hazo_jobs/hazo_auth contracts before any full build commitment.

### 2026-06-20 — Domain-level telemetry only; NextDNS recommended
No DPI/full-URL/TLS interception by design. Domains via DNS/SNI; NextDnsProvider preferred
for clean per-device attribution, Merlin SQLite as alternative.

### 2026-06-20 — Estimated active time via sessionisation, not measured dwell
Per-domain time is an explicit estimate (SESSION_GAP 5m, 1m floor), shown alongside the hard
query_count. Per-device presence time is genuine connected-time.

### 2026-06-20 — Capabilities live in app_user_grants, not hazo_auth roles
hazo_auth gates login + who is superadmin; fine-grained, optionally group-scoped capabilities
are too dynamic for roles and are app-managed with a request/approve workflow.

### 2026-06-20 — v1 blocking is internet on/off only
Per-device per-domain blocking is deferred to Backlog (DNS layer). Redesigned screens keep
v1 scope; earlier out-of-scope UI (packet inspection, content filtering, network.reboot) removed.

### 2026-06-20 — Built as an external consuming app of published hazo_* packages
NetWarden installs hazo_* from npm (not a workspace member): `src/app/` App Router, next.config
transpilePackages, webpack stubs for unused peers (next-auth). Decouples our release cadence from
the libraries; the cost is reconciling real published APIs vs assumed signatures (logged as build
deviations). See docs/phase1-feasibility-report.md.

### 2026-06-20 — Full app_ schema migrated upfront (one set)
All 10 app_ tables ship in migrations/0001_init.sql now, not phase-by-phase, so contract checks and
later phases build on a stable schema. Tables for later phases sit unused until then; acceptable for
a single-tenant home app on SQLite.

### 2026-06-20 — First superadmin via SUPERADMIN_EMAIL env var
The first superadmin is provisioned from the SUPERADMIN_EMAIL env var (login-time idempotent grant
through the hazo_auth role/scope chain), avoiding a hardcoded admin or manual DB seeding. Superadmin =
hazo_auth permission `netwarden:nw:superadmin`; finer capabilities stay in app_user_grants.

### 2026-06-20 — Telemetry provider deferred (NextDNS not set up)
No telemetry provider is chosen yet (the user's NextDNS is not configured), so TelemetryProvider has
only a NextDnsProvider stub returning "not configured". Phase 8 (telemetry) is blocked on this product
decision; NextDNS remains preferred. Tracked in the ledger.

### 2026-06-20 — Fetch-based autotests are self-contained (no real secrets)
Browser autotest scenarios reach server-only work via fetch() to dedicated /api/*-test routes that run
against isolated in-memory DBs and supply a throwaway JWT_SECRET when the env has none — so the suite
is green in CI without a real .env. Production auth still requires the user-placed .env (see .env.example).
