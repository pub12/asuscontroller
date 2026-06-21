# NetWarden — Master Plan
Home-network monitoring & control for an ASUS ZenWiFi AX, built on the hazo_* ecosystem.
Last updated: 2026-06-21

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
| 36 | 3 | 19 | 58 | 62% |

By phase:
| Phase | Done | Total |
|---|---|---|
| 1 Feasibility Spike | 5 | 7 |
| 2 Foundations | 8 | 8 |
| 3 Router + Sync | 3 | 4 |
| 4 Blocking Core | 5 | 5 |
| 5 Permissions | 4 | 4 |
| 6 Groups & Images | 5 | 5 |
| 7 Timers & Schedules | 4 | 4 |
| 8 Telemetry + Drill-down | 3 | 6 |
| 9 Analytics | 0 | 4 |
| 10 Polish | 2 | 5 |
| Backlog | 0 | 7 |

Recount commands:
- Done: `grep -c "^- \[x\]" master_plan.md`
- Partial: `grep -c "^- \[-\]" master_plan.md`
- Not started: `grep -c "^- \[ \]" master_plan.md`

## Phase Map
- **Phase 1 — Technical Feasibility Spike (active)** — de-risk router API, telemetry & hazo contracts; go/no-go gate. Throwaway/thin spike, NO production UI.
  - Router Feasibility — read + write path vs live router, reboot survival — `1/2 done, 1M left` (read path + block/restore write PROVEN live 2026-06-21; reboot-survival open)
  - Telemetry Feasibility — NextDNS per-device attribution + lag — `0/1 done, 1M left`
  - hazo Contracts — jobs / auth / persistence+secrets smoke test — `0/3 done, 3S left`
  - Gate — feasibility report + confirmed-contracts appendix + go/no-go — `0/1 done, 1M left`
- **Phase 2 — Foundations (planned)** — scaffold app + wire core hazo libs (only after GO).
  - App Scaffold — Next.js App Router, /autotest, Tailwind v4 @source — `0/1 done, 1M left`
  - Persistence & Config — hazo_connect migrations, hazo_env/config, hazo_secure — `0/3 done, 1M 2S left`
  - Auth & API — hazo_auth login/roles/first-superadmin, hazo_api foundation — `0/2 done, 2M left`
  - Shell — Login screen, Settings skeleton — `0/2 done, 2S left`
- **Phase 3 — RouterProvider + Device Sync (in progress)** — full sync slice shipped vs FakeRouterProvider; real AsusWrt productionisation pending the supervised hardware spike.
  - RouterProvider — AsusWrtProvider read+write, secrets, HazoError — `0/1 done, 1L left` (provider abstraction + FakeRouterProvider drop-in shipped; live AsusWrt productionisation hardware-blocked)
  - Sync Job — netwarden.sync recurring 60s, presence, new-device detect — `1/1 done` (separate worker process; runDeviceSync core + sync-test)
  - Devices — app_devices model + editable name/icon/notes/group — `1/1 done`
  - Explore (Devices) — searchable list, status chips, group badge — `1/1 done`
- **Phase 4 — Blocking Core (done, fake-first)** — device block/unblock + reconcile + audit; full engine built + verified vs FakeRouterProvider. Live write is the only piece pending the supervised hardware spike (guarded live-block-test.mjs built + dry-verified, not yet fired).
  - Block API — device.block/unblock via hazo_api routes — `1/1 done` (blockActions + block/unblock routes; devices-list-test green)
  - State & Reconcile — app_block_state + hazo_state CAS; drift reconcile in sync — `2/2 done` (hazo_state CAS/TTL marker; reconcile re-apply pass in runDeviceSync; reconcile-test green)
  - Audit — hazo_audit on every mutation; device audit-history view — `1/1 done` (outbox on every mutation + worker drain; audit-drain-test green)
  - Device Detail — access toggle, time-on-device, activity timeline (screen copy 4) — `1/1 done` (DeviceDetailScreen + getDeviceActivity; device-activity-test green)
- **Phase 5 — Permissions (done)** — capability grants (app_user_grants) + request/approve workflow + superadmin admin shell — shipped, fake-first.
  - Grants & Requests — app_user_grants + app_access_requests workflow — `2/2 done`
  - Mutation Gating — shared hazo_api guard checks grants server-side — `1/1 done`
  - Admin Screen — hazo_admin Users/Pending/Grants tabs (screen 06 redesign) — `1/1 done`
- **Phase 6 — Groups & Images (done)** — group CRUD + images (hazo_files/hazo_images) + Explore Groups + block-all — shipped.
  - Group CRUD — name/desc/type(person|generic)/color + members join — `1/1 done`
  - Images — hazo_files upload+validate, hazo_images resize/thumbnail — `1/1 done`
  - Explore (Groups) — card grid + block-all (screen.png); Create Group + Group detail (screen copy 5) — `2/2 done`
  - Group Block — block-all/unblock-all, per-device partial-failure capture — `1/1 done`
- **Phase 7 — Timers & Schedules (done)** — one-shot timers + future-dated + recurring windows + Block-timer modal + Schedules screen — shipped fake-first (AEST, edge-triggered, system-actor fires).
  - Timers — 15m/30m/1h/2h/custom/until-time; one-shot hazo_jobs unblock — `1/1 done`
  - Schedules — recurring/future blocks; app_schedules; modal (screen copy 2); Schedules screen — `3/3 done`
- **Phase 8 — Telemetry + Drill-down (done, fake-first)** — full telemetry vertical built + verified vs FakeTelemetryProvider (D14); NextDnsProvider stays a not-configured stub pending source decision.
  - TelemetryProvider — NextDnsProvider (+ Merlin alt, stock fallback) — `0/1 done, 1L left` (factory + FakeTelemetryProvider shipped; NextDnsProvider stub only — real source undecided)
  - Jobs — netwarden.ingest (1–5min); netwarden.rollup (daily) + prune — `1/2 done` (ingest done: watermark+dedupe, verified live 39 inserted / re-run deduped; rollup deferred)
  - Device Domain Views — top domains, recent timeline, first/last seen — `1/1 done` (drill-down on Device Detail; Today/7d UTC-day toggle; D15)
  - Empty States — hazo_ihelp copy for DoH / no-telemetry — `1/1 done` (monitoring-off empty state; telemetry-gap ops alert; D17)
- **Phase 9 — Analytics (planned)** — presence time + sessionised estimates + charts.
  - Presence & Estimates — app_device_presence; sessionisation (est. + query count) — `0/2 done, 2M left`
  - Charts — Analytics screen, date range, hazo_dataviz (screen copy / copy 3) — `0/1 done, 1M left`
  - Flags (optional) — hazo_umetrics feature flags / usage analytics — `0/1 done, 1M left`
- **Phase 10 — Polish (ops slice done; PWA/responsive planned)** — PWA, responsive desktop, notify, retention.
  - PWA & Responsive — installable; mobile→desktop responsive sweep — `0/2 done, 1M 1M left`
  - Ops — hazo_notify Telegram sync/job alerts; retention prune enforcement — `2/2 done` (notify alerting + retention shipped)
  - Extras (optional) — hazo_feedback / hazo_pdf export — `0/1 done, 1M left`
- **Backlog / Unscheduled (backlog)** — §15 future work, recorded so it isn't reinvented.
  - Future Control — per-device per-domain blocking; DoH handling — `0/2 done, 1L 1M left`
  - Future Devices — logical MAC-merge; per-user view scoping — `0/2 done, 2M left`
  - Future Reporting — event notifications; PDF export / product analytics — `0/2 done, 1S 1M left`
  - Privacy — per-group "monitoring on/off" flag for adults — `0/1 done, 1S left`

## The checklist

### Phase 1 — Technical Feasibility Spike
**Router Feasibility**
- [x] (P1)(M) Router read path: AsusWrtProvider.listClients() vs live router — login→asus_token, appGet.cgi get_clientlist(); confirm MAC/IP/hostname/band/online + token expiry — PROVEN live 2026-06-21: login OK, 36 online clients read with MAC/IP/band/online (target Tablet-kitchen @ 192.168.50.134, 5G); token TTL still assumed 1800s (unverified)
- [x] (P1)(M) Router write path: blockDevice/unblockDevice; verify access cut/restore AND reboot survival — CORRECTION 2026-06-21: the original set_client_state hook was a NO-OP (router returns HTTP 200 but never cuts traffic — the earlier "DISABLED/ENABLED proven" was a false positive based on the 200 response). Real blocking re-implemented via MULTIFILTER parental-control (read-modify-write of MULTIFILTER_MAC/_ENABLE=2/_DEVICENAME/_MACFILTER_DAYTIME_V2 + action_mode=apply + rc_service=restart_firewall). PROVEN live + human-confirmed 2026-06-21: Google home-kitchen (00:F4:8D:91:04:59) actually lost internet on block and regained it on unblock; reboot survival still OPEN (not tested)
**Telemetry Feasibility**
- [-] (P1)(M) NextDnsProvider: pull per-device domain events via API, map to MAC (resolveDeviceKey); measure freshness/lag — BLOCKED: provider undecided (NextDNS not set up); stub returns not-configured
**hazo Contracts**
- [x] (P1)(S) hazo_jobs contract: one-shot + recurring handler; kill/restart to confirm persistence + re-arm; observe retry semantics; lock signatures — spike-jobs.mjs PASS (real child-process restart); contracts in feasibility report
- [x] (P1)(S) hazo_auth contract: resolve subject+roles server-side; first-superadmin provisioning; scoped-role strings; lock signatures — auth-test autotest 5/5 green
- [x] (P1)(S) Persistence + secrets smoke test: hazo_connect SQLite + 1–2 app_ tables + hazo_secure creds in Next.js server; hazo_testing harness — schema-test + secret-test autotests green
**Gate**
- [-] (P1)(M) Feasibility report + confirmed-contracts appendix (§6) + go/no-go recommendation — PARTIAL: non-hardware sections finalized (§6 confirmed hazo contracts incl. jobs/runDeviceSync/D4-D5 + built-components appendix); hardware/telemetry sections (§§1-4) pending supervised spike

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
- [-] (P1)(L) Productionise AsusWrtProvider — read+write, secrets via hazo_secure, HazoError handling, server-side only — PARTIAL: RouterProvider abstraction + FakeRouterProvider (deterministic, sim hooks) shipped as the drop-in; getRouterProvider() factory lazy-loads AsusWrt only for ROUTER_PROVIDER=asus; live AsusWrt productionisation hardware-blocked (supervised spike)
**Sync Job**
- [x] (P1)(M) netwarden.sync job (hazo_jobs recurring 60s) — listClients() → upsert app_devices, update presence, detect new — pure runDeviceSync core + standalone worker process (scripts/worker.mjs, npm run worker) + sync-test autotest; D4/D5 semantics
**Devices**
- [x] (P1)(S) app_devices model + editable friendly name / icon / notes / primary group — deviceService + GET/PATCH/acknowledge APIs (field-ownership enforced)
**Explore (Devices)**
- [x] (P1)(M) Explore — Devices screen: searchable/filterable list (useDebounce), status chips (online/offline/blocked), group badge — HazoUiTable, status chips, group badge, New-pill acknowledge, edit dialog

### Phase 4 — Blocking Core
> Built + verified fake-first (vs FakeRouterProvider, hermetic temp-DB autotests). Live router write is bounded to one pinned MAC behind the guarded live-block-test.mjs and is pending the supervised hardware spike (see ledger D6/D7).
**Block API**
- [x] (P1)(M) device.block / device.unblock through hazo_api routes — blockActions + /api/devices/[id]/block|unblock; superadmin-gated; devices-list-test green
**State & Reconcile**
- [x] (P1)(M) app_block_state + hazo_state reconcile markers (TTL + optimistic CAS to avoid double-apply) — hazo_state CAS/TTL desired-state marker; app_block_state PK device_id
- [x] (P1)(M) Drift reconcile in netwarden.sync — compare intended vs router actual, re-apply or flag — reconcile pass in runDeviceSync re-applies intended blocks (never auto-unblocks); reconcile-test green
**Audit**
- [x] (P1)(S) Audit every mutation via hazo_audit; device audit-history view — hazo_audit outbox on every mutation + worker drainOnce; timeline in Device Detail; audit-drain-test green
**Device Detail**
- [x] (P1)(M) Device detail screen — access toggle, time-on-device, recent-activity timeline, collapsible audit history (design/screens/screen copy 4.png) — DeviceDetailScreen + getDeviceActivity (presence + intent/field timeline); device-activity-test green

### Phase 5 — Permissions
**Grants & Requests**
- [x] (P1)(M) app_user_grants — capability model (device/group block·unblock, schedule create·cancel), global|group scope
- [x] (P1)(M) Access request → approve/decline workflow (app_access_requests); direct grant; revoke
**Mutation Gating**
- [x] (P1)(M) Shared hazo_api guard — check grants server-side on every mutation, audited
**Admin Screen**
- [x] (P1)(M) Superadmin Admin screen on hazo_admin — Users / Pending requests / Grants tabs, scope-to-group (design/screens/screen copy 3.png context)

### Phase 6 — Groups & Images
**Group CRUD**
- [x] (P1)(M) Group CRUD — name, description, type (person|generic), color; app_groups + app_group_members join (multi-group, primary highlighted)
**Images**
- [x] (P1)(M) Group/person images via hazo_files (upload + type/size validate) + hazo_images (resize/thumbnail); image_file_id reference
**Explore (Groups)**
- [x] (P1)(M) Explore — Groups screen: card grid (image, member/online count, block status, Block all), FAB (design/screens/screen.png)
- [x] (P1)(M) Create Group screen (design/screens/screen copy 5.png) + Group detail screen (image, members, block-all, group analytics/schedules)
**Group Block**
- [x] (P1)(M) Block-all / Unblock-all members — iterate, per-device partial-failure capture + audit, honour per-group scope

### Phase 7 — Timers & Schedules
**Timers**
- [x] (P1)(M) Timer options — 15m / 30m / 1h / 2h / custom / until-time; backed by one-shot hazo_jobs unblock (cancel on early manual unblock)
**Schedules**
- [x] (P1)(M) Recurring + future-dated block/unblock (cron windows); app_schedules with job_id handle
- [x] (P1)(M) Block-with-timer modal — quick picks + until-time + recurring toggles (design/screens/screen copy 2.png)
- [x] (P1)(M) Schedules screen — active & upcoming one-shot + recurring; edit/cancel

### Phase 8 — Telemetry + Drill-down
> Built fake-first (vs FakeTelemetryProvider, hermetic ingest-test autotest). NextDnsProvider stays a not-configured stub until the real telemetry source is chosen (D14). netwarden.rollup + hazo_ihelp DoH empty state deferred.
**TelemetryProvider**
- [-] (P1)(L) Productionise TelemetryProvider — NextDnsProvider (+ MerlinSqliteProvider alt, AsusWebHistory fallback), API key via hazo_secure — PARTIAL: async factory + FakeTelemetryProvider (39-event deterministic seed) shipped; NextDnsProvider stub only (real source undecided)
**Jobs**
- [x] (P1)(M) netwarden.ingest job (recurring 1–5 min) → app_domain_events — watermark + half-open window + composite-PK pre-SELECT dedupe (D16); idempotent find-or-create schedule; boot one-shot; verified live (inserted 39, re-run deduped)
- [ ] (P1)(M) netwarden.rollup job (daily, off-peak AEST) → app_domain_rollup_daily + app_device_presence; prune raw events past retention
**Device Domain Views**
- [x] (P1)(M) Device domain drill-down — top domains (by query volume), recent-domains timeline, first/last seen — Today/7d UTC-day toggle on Device Detail (D15); per-group monitoring-off read-side gate (D17)
**Empty States**
- [x] (P2)(S) Low-fidelity/empty states when DoH or no telemetry provider configured — monitoring-off empty state on drill-down; telemetry-gap ops alert on configured:false (D17)
- [ ] (P2)(S) hazo_ihelp copy for DoH / no-telemetry (deferred)

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
- [x] (P2)(S) hazo_notify Telegram alerting — sync / job / telemetry-gap failures
- [x] (P2)(S) Retention pruning enforcement (default 30d raw, then aggregated only)
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
| ~~Live router spike staged~~ → **READ proven; WRITE corrected 2026-06-21** | Contracts proven against real router | Read path proven (login OK, 36 clients). WRITE CORRECTION: live-block-test.mjs's set_client_state returned HTTP 200 but did NOT cut traffic (false positive). Real block re-implemented via MULTIFILTER + restart_firewall; PROVEN live + human-confirmed (Google home-kitchen actually lost/regained internet). Reboot-survival still untested | — (read+write done) / supervised reboot test for survival | Reboot-survival check still pending |
| Reboot-survival unproven | Confirmed block persists across reboot | Documented open item | Run during supervised session | Drives reconcile design in Phase 4 |
| Unofficial ASUSWRT HTTP endpoints | Official API | RouterProvider adapter isolates churn | Re-eval per firmware | Block path breaks on update |
| Domain-level telemetry only (no DPI) | Per-URL/app visibility | DNS/SNI domains via NextDNS | Out of scope by design | — |
| "Time per domain" is estimated | Measured dwell time | Sessionisation model, labeled (est.) | — | Better signal available |
| Capabilities outside hazo_auth roles | One auth model | app_user_grants table | Fold into hazo_auth if it gains dynamic caps | hazo_auth adds fine-grained caps |
| v1 blocking = internet on/off only | Per-domain blocking | Whole-device/group block | Backlog DNS-layer item | Phase 2 / GO confirmed |
| D1 · Fake-provider-first sync slice | Full slice proven vs live router | Entire vertical (sync→worker→API→UI) built+verified vs FakeRouterProvider; real AsusWrt drops in unchanged | Swap to AsusWrtProvider after spike | Router hardware + supervised session available |
| D2 · Separate worker process (no instrumentation.ts) | Single integrated runtime | Standalone scripts/worker.mjs runs the scheduler+worker (imports pure runDeviceSync/Fake provider over native TS) | Re-evaluate co-locating once deploy model is set | Deploy/runtime topology decided |
| D3 · Full device edit + acknowledge now | — (this is the intended UX) | friendly_name/icon/notes/primary_group editable + is_new acknowledge in the Devices screen | — | — |
| D4 · Capped elapsed-minute presence + immediate offline | Exact connected-time accounting | Presence accrues capped elapsed minutes on consecutive online ticks; offline applied immediately (final-interval undercount accepted) | Finer-grained presence if a use case needs it | Presence accuracy complaint / billing-grade need |
| D5 · Sync/user field-ownership split | One writer per row | Sync owns router fields; API owns friendly_name/icon/notes/primary_group/is_new — disjoint columns, edit-vs-sync safe | — | — |
| D6 · Live router read/write — **READ proven; WRITE corrected+proven 2026-06-21** | Read+write proven against the real ASUS | Read proven (36 clients). WRITE: set_client_state was a no-op (HTTP 200, no traffic cut — false positive). Re-implemented as MULTIFILTER parental-control write (ENABLE=2 + restart_firewall); human-confirmed Google home-kitchen actually lost/regained internet. getBlockState now reads the live table. Reboot-survival NOT yet tested | Reboot-survival check during a future supervised session | Reboot behaviour matters for reconcile guarantees |
| D7 · Blocking core built fake-first; live write tightly bounded | Whole block/unblock/reconcile slice proven vs live router | Full engine (API → blockActions → hazo_state marker → reconcile → audit → Device Detail) verified vs FakeRouterProvider; first live write bounded to one pinned MAC with three-layer fail-safe + 5-min auto-restore; reboot-survival still open | Swap to AsusWrtProvider after the spike; verify reboot survival | Supervised spike available |
| D8 · hazo_state for block desired-state | Bespoke locking | hazo_state CAS + TTL marker holds intended block state to avoid double-apply / racing the reconcile pass | Revisit if hazo_state limits surface | Contention or TTL-expiry issues observed |
| D9 · hazo_audit outbox + drain in worker | Synchronous audit on the request path | Mutations write an audit outbox row; worker.mjs drains via startAuditWorker.drainOnce after each sync (busy_timeout set, react-server conditions) | Co-locate drain if runtime topology merges | Deploy/runtime model decided (ties to D2) |
| getBlockState unknown on stock ASUS firmware | Router reports authoritative per-device block state | getBlockState returns null on stock firmware ⇒ reconcile treats "unknown" as "re-apply intended" (re-applies block, never auto-unblocks) and trusts app_block_state as source of truth | Merlin/JFFS or a firmware that exposes block state | Firmware exposes reliable block-state read |
| D10 · Schedules = app_schedules + hazo_jobs | A first-class scheduling subsystem | One-shot via `jobs.submit({runAt})`, recurring via `jobs.schedules.create({cron})`; fires run as a **system actor** (audited as schedule-initiated, not re-checked per fire); **edge-triggered** writes to app_block_state exactly like a manual action (manual unblock wins until the next edge) | Continuous-assert "window membership" model if needed | A continuous-assert window requirement appears |
| D11 · Fixed AEST (Australia/Sydney) for all schedule evaluation | Per-household timezone | Worker runs with `TZ=Australia/Sydney`; create-time wall-clock ("until 9pm") converted to an absolute instant in AEST (DST-safe via Intl) | Per-household / multi-TZ schedule evaluation | Multi-timezone households appear |
| D12 · Fire-late on worker downtime | Exactly-on-time fires with catch-up policy | hazo_jobs default: past-due jobs promote to pending on worker restart and fire late; no staleness-skip; reconcile smooths resulting state | Add a staleness-skip / catch-up policy | Surprise late blocks are reported |
| D13 · Recurring window = two linked rows | First-class window entity | A block-cron row + an unblock-cron row linked via `window_id` (migration 0005), reusing the one-shot/recurring machinery | Promote to a first-class window entity | A first-class window entity is warranted |
| D14 · Telemetry vertical built fake-provider-first | Wire real NextDNS telemetry now | Full Phase-8 stack (TelemetryProvider iface → FakeTelemetryProvider 39-event deterministic seed → worker-pure runTelemetryIngest → netwarden.ingest worker schedule → per-device domain drill-down UI) built + verified vs a deterministic Fake; NextDnsProvider stays a not-configured stub and drops in unchanged | Swap to NextDnsProvider once the real-source decision (NextDNS vs Merlin SQLite vs ASUS history) unblocks | Real telemetry source chosen + credentials available |
| D15 · Drill-down "Today" = UTC day | Local (AEST) day | "Today"/"7d" windows use the UTC day (`toISOString().slice(0,10)`), reusing the SAME injected `todayIso` as the presence card directly above it on Device Detail — deliberate consistency; injection keeps a future move to local-day a one-call-site change (for both cards together) | Move presence + domains to local day together | A user-facing "today is wrong" report |
| D16 · Ingest idempotency = watermark + composite-PK pre-SELECT | Rely on `SELECT changes()` for insert/dup counts | Watermark = `MAX(ts)`; provider queried over a half-open `[from,to)`; dedupe via a deterministic composite PK (`dom_`+mac+ts+domain) using a pre-SELECT existence check (+ `INSERT OR IGNORE` backstop). Chosen because the hazo_connect SQLite adapter doesn't reliably surface mutation row counts (same reason pruneEvents COUNTs-then-DELETEs); verified live (boot ingest inserted 39, re-run fetched 1 / inserted 0 / skipped 1) | — | — |
| D17 · Per-group monitoring flag = read-side gate | Suppress/delete events at ingest time | `app_groups.monitoring_enabled` (DEFAULT 1); the drill-down read fn checks `COALESCE(g.monitoring_enabled,1)` via the device's primary group and returns an empty monitoring-off result BEFORE reading any events — data still flows into the table but is suppressed on read; null/no group ⇒ on | Ingest-time suppression or a retention purge if a stronger guarantee is needed | A "don't even store it" requirement appears |

> Discipline: log every real trade-off here as it's made — compromise, the ideal, the interim
> in place, the long-term fix, and the trigger that should make us revisit.
