# NetWarden — Master Plan
Home-network monitoring & control for an ASUS ZenWiFi AX, built on the hazo_* ecosystem.
Last updated: 2026-06-20

## How to use this file
- Tasks are organized **Phase → Section → task**. Phase = WHEN, Section = WHAT area,
  Priority (P1/P2/P3) = importance within the phase, Size (L/M/S) = dev effort (orthogonal).
- Task line: `- [ ] (P1)(L) Description`. Markers: `[ ]` not started, `[-]` partial, `[x]` done.
- To park work, move it to a later phase, or to **Backlog / Unscheduled** if the phase is TBD.
- Completed tasks collapse to one line; verbose writeups → CHANGELOG.md; decisions → DECISIONS.md.
- The **Phase Map** and the checklist must never disagree — update both together.
- Design is **mobile-first, desktop-responsive**. UI reference screens live in `design/screens/`
  and the PRD is `design/netwarden_PRD_v2.md`.
- Keep dashboard counts, Phase Map size summaries, and the ledger current at end of each session.

## Progress dashboard
Overall:
| Done | In progress | Not started | Total | % |
|---|---|---|---|---|
| 11 | 4 | 43 | 58 | 19% |

By phase:
| Phase | Done | Total |
|---|---|---|
| 1 Feasibility Spike | 3 | 7 |
| 2 Foundations | 8 | 8 |
| 3 Router + Sync | 0 | 4 |
| 4 Blocking Core | 0 | 5 |
| 5 Permissions | 0 | 4 |
| 6 Groups & Images | 0 | 5 |
| 7 Timers & Schedules | 0 | 4 |
| 8 Telemetry + Drill-down | 0 | 5 |
| 9 Analytics | 0 | 4 |
| 10 Polish | 0 | 5 |
| Backlog | 0 | 7 |

Recount commands:
- Done: `grep -c "^- \[x\]" master_plan.md`
- Partial: `grep -c "^- \[-\]" master_plan.md`
- Not started: `grep -c "^- \[ \]" master_plan.md`

## Phase Map
- **Phase 1 — Technical Feasibility Spike (active)** — de-risk router API, telemetry & hazo contracts; go/no-go gate. Throwaway/thin spike, NO production UI.
  - Router Feasibility — read + write path vs live router, reboot survival — `0/2 done, 2M left`
  - Telemetry Feasibility — NextDNS per-device attribution + lag — `0/1 done, 1M left`
  - hazo Contracts — jobs / auth / persistence+secrets smoke test — `0/3 done, 3S left`
  - Gate — feasibility report + confirmed-contracts appendix + go/no-go — `0/1 done, 1M left`
- **Phase 2 — Foundations (planned)** — scaffold app + wire core hazo libs (only after GO).
  - App Scaffold — Next.js App Router, /autotest, Tailwind v4 @source — `0/1 done, 1M left`
  - Persistence & Config — hazo_connect migrations, hazo_env/config, hazo_secure — `0/3 done, 1M 2S left`
  - Auth & API — hazo_auth login/roles/first-superadmin, hazo_api foundation — `0/2 done, 2M left`
  - Shell — Login screen, Settings skeleton — `0/2 done, 2S left`
- **Phase 3 — RouterProvider + Device Sync (planned)** — productionise router adapter + sync.
  - RouterProvider — AsusWrtProvider read+write, secrets, HazoError — `0/1 done, 1L left`
  - Sync Job — netwarden.sync recurring 60s, presence, new-device detect — `0/1 done, 1M left`
  - Devices — app_devices model + editable name/icon/notes/group — `0/1 done, 1S left`
  - Explore (Devices) — searchable list, status chips, group badge — `0/1 done, 1M left`
- **Phase 4 — Blocking Core (planned)** — device block/unblock + reconcile + audit.
  - Block API — device.block/unblock via hazo_api routes — `0/1 done, 1M left`
  - State & Reconcile — app_block_state + hazo_state CAS; drift reconcile in sync — `0/2 done, 2M left`
  - Audit — hazo_audit on every mutation; device audit-history view — `0/1 done, 1S left`
  - Device Detail — access toggle, time-on-device, activity timeline (screen copy 4) — `0/1 done, 1M left`
- **Phase 5 — Permissions (planned)** — capability grants + request/approve + admin shell.
  - Grants & Requests — app_user_grants + app_access_requests workflow — `0/2 done, 2M left`
  - Mutation Gating — shared hazo_api guard checks grants server-side — `0/1 done, 1M left`
  - Admin Screen — hazo_admin Users/Pending/Grants tabs (screen 06 redesign) — `0/1 done, 1M left`
- **Phase 6 — Groups & Images (planned)** — group CRUD, images, Explore Groups, block-all.
  - Group CRUD — name/desc/type(person|generic)/color + members join — `0/1 done, 1M left`
  - Images — hazo_files upload+validate, hazo_images resize/thumbnail — `0/1 done, 1M left`
  - Explore (Groups) — card grid + block-all (screen.png); Create Group + Group detail (screen copy 5) — `0/2 done, 2M left`
  - Group Block — block-all/unblock-all, per-device partial-failure capture — `0/1 done, 1M left`
- **Phase 7 — Timers & Schedules (planned)** — one-shot timers + recurring windows.
  - Timers — 15m/30m/1h/2h/custom/until-time; one-shot hazo_jobs unblock — `0/1 done, 1M left`
  - Schedules — recurring/future blocks; app_schedules; modal (screen copy 2); Schedules screen — `0/3 done, 3M left`
- **Phase 8 — Telemetry + Drill-down (planned)** — NextDNS provider, ingest/rollup, domain views.
  - TelemetryProvider — NextDnsProvider (+ Merlin alt, stock fallback) — `0/1 done, 1L left`
  - Jobs — netwarden.ingest (1–5min); netwarden.rollup (daily) + prune — `0/2 done, 2M left`
  - Device Domain Views — top domains, recent timeline, first/last seen — `0/1 done, 1M left`
  - Empty States — hazo_ihelp copy for DoH / no-telemetry — `0/1 done, 1S left`
- **Phase 9 — Analytics (planned)** — presence time + sessionised estimates + charts.
  - Presence & Estimates — app_device_presence; sessionisation (est. + query count) — `0/2 done, 2M left`
  - Charts — Analytics screen, date range, hazo_dataviz (screen copy / copy 3) — `0/1 done, 1M left`
  - Flags (optional) — hazo_umetrics feature flags / usage analytics — `0/1 done, 1M left`
- **Phase 10 — Polish (planned)** — PWA, responsive desktop, notify, retention.
  - PWA & Responsive — installable; mobile→desktop responsive sweep — `0/2 done, 1M 1M left`
  - Ops — hazo_notify Telegram sync/job alerts; retention prune enforcement — `0/2 done, 2S left`
  - Extras (optional) — hazo_feedback / hazo_pdf export — `0/1 done, 1M left`
- **Backlog / Unscheduled (backlog)** — §15 future work, recorded so it isn't reinvented.
  - Future Control — per-device per-domain blocking; DoH handling — `0/2 done, 1L 1M left`
  - Future Devices — logical MAC-merge; per-user view scoping — `0/2 done, 2M left`
  - Future Reporting — event notifications; PDF export / product analytics — `0/2 done, 1S 1M left`
  - Privacy — per-group "monitoring on/off" flag for adults — `0/1 done, 1S left`

## The checklist

### Phase 1 — Technical Feasibility Spike
**Router Feasibility**
- [-] (P1)(M) Router read path: AsusWrtProvider.listClients() vs live router — login→asus_token, appGet.cgi get_clientlist(); confirm MAC/IP/hostname/band/online + token expiry — STAGED: AsusWrtProvider draft + spike-router.mjs written, NOT run (no hardware)
- [-] (P1)(M) Router write path: blockDevice/unblockDevice via applyapp.cgi; verify access cut/restore AND reboot survival — STAGED: set_client_state draft + spike write path written, NOT run; reboot survival open
**Telemetry Feasibility**
- [-] (P1)(M) NextDnsProvider: pull per-device domain events via API, map to MAC (resolveDeviceKey); measure freshness/lag — BLOCKED: provider undecided (NextDNS not set up); stub returns not-configured
**hazo Contracts**
- [x] (P1)(S) hazo_jobs contract: one-shot + recurring handler; kill/restart to confirm persistence + re-arm; observe retry semantics; lock signatures — spike-jobs.mjs PASS (real child-process restart); contracts in feasibility report
- [x] (P1)(S) hazo_auth contract: resolve subject+roles server-side; first-superadmin provisioning; scoped-role strings; lock signatures — auth-test autotest 5/5 green
- [x] (P1)(S) Persistence + secrets smoke test: hazo_connect SQLite + 1–2 app_ tables + hazo_secure creds in Next.js server; hazo_testing harness — schema-test + secret-test autotests green
**Gate**
- [-] (P1)(M) Feasibility report + confirmed-contracts appendix (§6) + go/no-go recommendation — PARTIAL: skeleton + hazo contracts written; hardware/telemetry sections pending supervised spike

### Phase 2 — Foundations
**App Scaffold**
- [x] (P1)(M) Next.js App Router app scaffolded per workspace standard (test-app/, /autotest on hazo_ui/test-harness, Tailwind v4 @source wiring)
**Persistence & Config**
- [x] (P1)(M) hazo_connect migrations for app_ tables (migrations/) — all 10 app_ tables
- [x] (P1)(S) hazo_env / hazo_config config (HAZO_ENV convention) + doctor
- [x] (P1)(S) hazo_secure wired for router & telemetry credentials
**Auth & API**
- [x] (P1)(M) hazo_auth wired — login, role resolution, first superadmin (env-var SUPERADMIN_EMAIL)
- [x] (P1)(M) hazo_api route foundation — ok/fail envelopes, error codes, Zod→OpenAPI 3.1 + Swagger UI, withRequestContext, rate limiting
**Shell**
- [x] (P1)(S) Login screen (hazo_auth)
- [x] (P2)(S) Settings screen skeleton (superadmin) + bottom nav (Explore·Schedules·Analytics·Admin) — + login-redirect middleware

### Phase 3 — RouterProvider + Device Sync
**RouterProvider**
- [ ] (P1)(L) Productionise AsusWrtProvider — read+write, secrets via hazo_secure, HazoError handling, server-side only
**Sync Job**
- [ ] (P1)(M) netwarden.sync job (hazo_jobs recurring 60s) — listClients() → upsert app_devices, update presence, detect new
**Devices**
- [ ] (P1)(S) app_devices model + editable friendly name / icon / notes / primary group
**Explore (Devices)**
- [ ] (P1)(M) Explore — Devices screen: searchable/filterable list (useDebounce), status chips (online/offline/blocked), group badge

### Phase 4 — Blocking Core
**Block API**
- [ ] (P1)(M) device.block / device.unblock through hazo_api routes
**State & Reconcile**
- [ ] (P1)(M) app_block_state + hazo_state reconcile markers (TTL + optimistic CAS to avoid double-apply)
- [ ] (P1)(M) Drift reconcile in netwarden.sync — compare intended vs router actual, re-apply or flag
**Audit**
- [ ] (P1)(S) Audit every mutation via hazo_audit; device audit-history view
**Device Detail**
- [ ] (P1)(M) Device detail screen — access toggle, time-on-device, recent-activity timeline, collapsible audit history (design/screens/screen copy 4.png)

### Phase 5 — Permissions
**Grants & Requests**
- [ ] (P1)(M) app_user_grants — capability model (device/group block·unblock, schedule create·cancel), global|group scope
- [ ] (P1)(M) Access request → approve/decline workflow (app_access_requests); direct grant; revoke
**Mutation Gating**
- [ ] (P1)(M) Shared hazo_api guard — check grants server-side on every mutation, audited
**Admin Screen**
- [ ] (P1)(M) Superadmin Admin screen on hazo_admin — Users / Pending requests / Grants tabs, scope-to-group (design/screens/screen copy 3.png context)

### Phase 6 — Groups & Images
**Group CRUD**
- [ ] (P1)(M) Group CRUD — name, description, type (person|generic), color; app_groups + app_group_members join (multi-group, primary highlighted)
**Images**
- [ ] (P1)(M) Group/person images via hazo_files (upload + type/size validate) + hazo_images (resize/thumbnail); image_file_id reference
**Explore (Groups)**
- [ ] (P1)(M) Explore — Groups screen: card grid (image, member/online count, block status, Block all), FAB (design/screens/screen.png)
- [ ] (P1)(M) Create Group screen (design/screens/screen copy 5.png) + Group detail screen (image, members, block-all, group analytics/schedules)
**Group Block**
- [ ] (P1)(M) Block-all / Unblock-all members — iterate, per-device partial-failure capture + audit, honour per-group scope

### Phase 7 — Timers & Schedules
**Timers**
- [ ] (P1)(M) Timer options — 15m / 30m / 1h / 2h / custom / until-time; backed by one-shot hazo_jobs unblock (cancel on early manual unblock)
**Schedules**
- [ ] (P1)(M) Recurring + future-dated block/unblock (cron windows); app_schedules with job_id handle
- [ ] (P1)(M) Block-with-timer modal — quick picks + until-time + recurring toggles (design/screens/screen copy 2.png)
- [ ] (P1)(M) Schedules screen — active & upcoming one-shot + recurring; edit/cancel

### Phase 8 — Telemetry + Drill-down
**TelemetryProvider**
- [ ] (P1)(L) Productionise TelemetryProvider — NextDnsProvider (+ MerlinSqliteProvider alt, AsusWebHistory fallback), API key via hazo_secure
**Jobs**
- [ ] (P1)(M) netwarden.ingest job (recurring 1–5 min) → app_domain_events
- [ ] (P1)(M) netwarden.rollup job (daily, off-peak AEST) → app_domain_rollup_daily + app_device_presence; prune raw events past retention
**Device Domain Views**
- [ ] (P1)(M) Device domain drill-down — top domains (by query volume), recent-domains timeline, first/last seen
**Empty States**
- [ ] (P2)(S) Low-fidelity/empty states (hazo_ihelp) when DoH or no telemetry provider configured

### Phase 9 — Analytics
**Presence & Estimates**
- [ ] (P1)(M) Per-device presence time (genuine connected-time) accumulated → app_device_presence
- [ ] (P1)(M) Per-domain estimated active time — sessionisation (SESSION_GAP 5m, 1m floor); present as estimate alongside hard query_count
**Charts**
- [ ] (P1)(M) Analytics screen — date range, active-time chart, per-device/per-group toggle, Top Domains (hazo_dataviz); est. labels + telemetry-coverage panel (design/screens/screen copy.png, screen copy 3.png)
**Flags (optional)**
- [ ] (P3)(M) Feature-flagging / product usage analytics via hazo_umetrics

### Phase 10 — Polish
**PWA & Responsive**
- [ ] (P2)(M) PWA-installable; one-handed empty/low-fidelity states
- [ ] (P2)(M) Desktop-responsive sweep across all screens (mobile-first → desktop layouts)
**Ops**
- [ ] (P2)(S) hazo_notify Telegram alerting — sync / job / telemetry-gap failures
- [ ] (P2)(S) Retention pruning enforcement (default 30d raw, then aggregated only)
**Extras (optional)**
- [ ] (P3)(M) Optional hazo_feedback in-app feedback / hazo_pdf analytics export

### Backlog / Unscheduled
**Future Control**
- [ ] (P2)(L) Per-device per-domain blocking (DNS layer — Merlin DNSFilter / NextDNS per-device denylists)
- [ ] (P3)(M) DoH handling (force/redirect or block) to restore telemetry fidelity
**Future Devices**
- [ ] (P3)(M) Logical device merge for MAC-randomised devices
- [ ] (P3)(M) Per-user view scoping (restrict which groups a non-admin can see)
**Future Reporting**
- [ ] (P3)(S) Event notifications (block fired, new-device joined, schedule fired) via hazo_notify
- [ ] (P3)(M) PDF analytics export (hazo_pdf) / product analytics (hazo_umetrics)
**Privacy**
- [ ] (P3)(S) Per-group "monitoring on/off" flag for adults' devices

## Trade-off ledger
| Compromise | Ideal | Interim | Long-term fix | Trigger to revisit |
|---|---|---|---|---|
| Telemetry provider undecided (NextDNS not set up; stock firmware) | Clean per-device domain telemetry | Provider stubbed "not configured"; Phase 8 blocked | Choose NextDNS (preferred) / Merlin / stock history | Before any telemetry work |
| Live router spike staged, not run | Contracts proven against real router | Foundations + non-hardware contracts proven; scripts ready | Supervised spike session | Router + guinea-pig MAC available with a human |
| Reboot-survival unproven | Confirmed block persists across reboot | Documented open item | Run during supervised session | Drives reconcile design in Phase 4 |
| Unofficial ASUSWRT HTTP endpoints | Official API | RouterProvider adapter isolates churn | Re-eval per firmware | Block path breaks on update |
| Domain-level telemetry only (no DPI) | Per-URL/app visibility | DNS/SNI domains via NextDNS | Out of scope by design | — |
| "Time per domain" is estimated | Measured dwell time | Sessionisation model, labeled (est.) | — | Better signal available |
| Capabilities outside hazo_auth roles | One auth model | app_user_grants table | Fold into hazo_auth if it gains dynamic caps | hazo_auth adds fine-grained caps |
| v1 blocking = internet on/off only | Per-domain blocking | Whole-device/group block | Backlog DNS-layer item | Phase 2 / GO confirmed |

> Discipline: log every real trade-off here as it's made — compromise, the ideal, the interim
> in place, the long-term fix, and the trigger that should make us revisit.
