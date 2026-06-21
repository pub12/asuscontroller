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

### 2026-06-21 — D1 · Device-sync vertical slice built fake-provider-first
The entire device-sync vertical — sync core → recurring worker → app_devices → APIs → Explore Devices
screen — was built and verified against a deterministic FakeRouterProvider, with zero live router/NextDNS
traffic (ROUTER_PROVIDER=fake throughout). RouterClient (`{mac,ip,name,connected,band,vendor}`) is the
clean seam, so the real AsusWrtProvider drops in unchanged after the supervised hardware spike. Lets the
whole slice ship and demo now while the live-router work stays hardware-blocked.

### 2026-06-21 — D2 · Sync runs in a separate worker process (not instrumentation.ts)
netwarden.sync runs from a standalone `scripts/worker.mjs` (hazo_jobs scheduler+worker) rather than an
in-process instrumentation.ts hook. The worker imports the PURE `runDeviceSync` core and FakeRouterProvider
directly over Node's native TS type-stripping (type-only imports, no `server-only`, no `@/` aliases), and
builds its own better-sqlite3 adapter exposing both `raw()` (hazo_jobs) and `rawQuery()` (sync core).
Keeps the long-running job out of the request runtime and avoids the server-only/Turbopack worker-kill
issues; revisit when the deploy topology is fixed.

### 2026-06-21 — D3 · Devices screen gets full inline edit + acknowledge
The Explore Devices screen ships full inline editing (friendly name / icon / notes / primary group) plus
acknowledge-new, not a read-only list — completing the Phase 3 Devices (S) item in one pass.

### 2026-06-21 — D4 · Immediate offline + capped elapsed-minute presence
A device flips to offline immediately on the first tick it is absent. Presence time accrues the capped
elapsed minutes between consecutive online ticks (capped so a long worker outage can't dump a huge block).
The trade-off is a final-interval undercount (the minutes between the last-seen-online tick and going
offline are not credited) — accepted for v1; revisit only if presence accuracy becomes billing-grade.

### 2026-06-21 — D5 · Sync vs user field-ownership split
app_devices columns are split by writer: the sync job owns router-reported fields (mac, hostname, vendor,
current_ip, last_band, status, first_seen, last_seen) and never clobbers user-owned fields; the API owns
friendly_name, icon, notes, primary_group_id, and is_new (cleared via acknowledge). Disjoint column sets
mean a user edit and a concurrent sync tick can't stomp each other.

### 2026-06-21 — D6 · Live router read proven; write corrected + proven
Read path proven against the real ASUS router (36 clients returned with MAC/IP/band/online). The first
write attempt via `set_client_state` was a silent no-op — the router returned HTTP 200 but never cut
traffic, making the initial "proven" claim a false positive. Blocking was re-implemented as a MULTIFILTER
parental-control write (ENABLE=2 + restart_firewall read-modify-write), and human-confirmed: a real device
(Google home-kitchen) actually lost then regained internet access. `getBlockState` now reads the live
MULTIFILTER table. Reboot-survival remains untested.

### 2026-06-21 — D7 · Blocking core built fake-first; live write tightly bounded
The full block/unblock/reconcile engine — API → blockActions → hazo_state marker → reconcile pass →
audit outbox → Device Detail — was built and verified entirely against FakeRouterProvider, with hermetic
temp-DB autotests throughout. The first live write was deliberately bounded to one pinned MAC behind a
three-layer fail-safe with a 5-minute auto-restore (guarded live-block-test.mjs). Real AsusWrtProvider
drops in after the supervised spike completes.

### 2026-06-21 — D8 · hazo_state for block desired-state
A hazo_state CAS + TTL marker holds the intended block state per device, rather than a bespoke lock.
This prevents double-apply and avoids races between a manual block action and the reconcile pass in the
sync worker. Revisit if hazo_state TTL expiry or contention surfaces as an issue.

### 2026-06-21 — D9 · hazo_audit outbox + drain in worker
Every block/unblock mutation writes an audit outbox row rather than calling hazo_audit synchronously on
the request path. The worker drains via `startAuditWorker.drainOnce()` after each sync tick
(busy_timeout set, react-server module conditions respected). This avoids react-server boundary issues
and keeps heavy audit I/O off the request path. Ties to D2 (separate worker process).

### 2026-06-21 — D10 · Schedules = app_schedules + hazo_jobs
One-shot timers use `jobs.submit({runAt})`; recurring block/unblock windows use
`jobs.schedules.create({cron})`. Fires run as a SYSTEM actor (audited as schedule-initiated, not
re-checked per fire) and are edge-triggered: a fire writes app_block_state exactly like a manual action,
so a manual unblock wins until the next scheduled edge. This is simpler than a continuous-assert window
model, which is deferred until a requirement for it appears.

### 2026-06-21 — D11 · Fixed AEST for all schedule evaluation
The worker process runs with `TZ=Australia/Sydney`. A create-time wall-clock expression ("until 9pm") is
converted to an absolute instant in AEST at creation time, which is DST-safe via Intl. Per-household
multi-timezone support is deferred; revisit when a multi-timezone household appears.

### 2026-06-21 — D12 · Fire-late on worker downtime
hazo_jobs default behaviour: past-due jobs promote to pending on worker restart and fire late rather than
being skipped. No staleness-skip policy is applied; the reconcile pass smooths the resulting device
state. Accepted for v1; revisit with a catch-up policy if surprise late blocks are reported by users.

### 2026-06-21 — D13 · Recurring window = two linked rows
A recurring block/unblock window is represented as two rows — a block-cron row and an unblock-cron row —
linked via a `window_id` column (migration 0005). This reuses the existing one-shot and recurring job
machinery without introducing a first-class window entity. Promote to a first-class entity if the model
proves insufficient.
