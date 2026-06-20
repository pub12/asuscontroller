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
