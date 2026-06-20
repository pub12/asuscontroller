# NetWarden — Home Network Control
## Product Requirements Document (PRD) v2

**Working title:** NetWarden
**Owner:** Pubs / Hazo Services
**Target device:** ASUS ZenWiFi AX (ASUSWRT firmware)
**Stack:** Next.js (App Router) + Tailwind, SQLite (via `hazo_connect`), built on the `hazo_*` ecosystem
**Status:** Draft for implementation planning (hand to Claude Code after sign-off)

**What changed in v2**
- Re-architected to **reuse `hazo_*` packages wherever one already solves the problem** (per the Hazo Workspace "Use What Exists" principle). v1 only named `hazo_auth` and `hazo_jobs`; v2 leans on ~16 packages and removes hand-rolled equivalents (custom audit table, custom secrets handling, custom CRUD, custom charts, custom admin shell, etc.).
- Restructured delivery into **phases led by a Phase 1 technical-feasibility spike** that de-risks the unofficial router API, telemetry, and the `hazo_jobs`/`hazo_auth` contracts **before** any full build commitment, with an explicit **go/no-go gate**.

---

## 1. Overview

NetWarden is a mobile-first web app for monitoring and controlling devices on a home network served by an ASUS ZenWiFi AX router. It lets an authorised household admin see every connected device, organise devices into manual groups (often representing a person), block or unblock internet access for a device or a whole group — optionally on a timer or schedule — and drill into per-device domain activity and time-based analytics.

Access is gated by `hazo_auth`. Viewing is open to any authenticated user; block/unblock actions are capability-gated, with a superadmin who grants or declines those capabilities.

NetWarden is a **consuming app** of the Hazo workspace. It does not reinvent infrastructure: identity, HTTP plumbing, persistence, logging, config, secrets, files, jobs, audit, notifications, admin UI, and charts are all delivered by existing `hazo_*` packages. NetWarden's own code is limited to the genuinely novel parts: the **RouterProvider**, the **TelemetryProvider**, the **block/reconcile domain logic**, and the **NetWarden-specific screens**.

---

## 2. Goals & Non-Goals

### Goals
- Single pane of glass to **explore** the network by **groups** and by **devices**, mobile-first.
- **Block / unblock** internet access per device and per group, with **timers** (block for N minutes / until a time) and **recurring schedules**, managed via `hazo_jobs`.
- **Drill into a device** to see which **domains** it has been reaching.
- **Analytics**: estimated time spent per device and per domain (or a defined equivalent), rendered with `hazo_dataviz`.
- **Group images** (including a person's photo/avatar), stored/validated via `hazo_files` and processed via `hazo_images`.
- **Permission model**: authenticated users can view; block/unblock requires granted capabilities; a superadmin assigns or declines them.
- **Maximise reuse** of the `hazo_*` ecosystem; minimise bespoke infrastructure code.

### Non-Goals (v1)
- Per-domain blocking per device (deferred — see §15). v1 blocking is **internet-access on/off** at device and group level.
- Deep-packet inspection, full-URL capture, or TLS interception. Not done — by design.
- Multi-router / multi-site management. Single ZenWiFi AX (incl. AiMesh nodes behind one main router).
- Replacing the router's own AiProtection / parental control category filters.

---

## 3. Personas & Roles

| Role | Source | Can do |
|------|--------|--------|
| **Superadmin** | `hazo_auth` role `netwarden:{appId}:superadmin` | Everything. Manage users, grant/revoke capabilities, approve/decline access requests, configure router & telemetry. |
| **Authorised user** | `hazo_auth` authenticated subject | View/explore all groups, devices, domains, analytics. Request capabilities. Perform only the block/unblock/schedule actions explicitly granted. |
| **Unauthenticated** | — | No access. Redirected to `hazo_auth` login. |

> Viewing is intentionally **not** capability-gated in v1 — any authenticated household member can see the network. Only mutations (block/unblock/schedule) are gated. This can be tightened later if needed.

---

## 4. Key Technical Constraints (read before building)

These shape the architecture and set honest expectations. They are also the primary subjects of the **Phase 1 feasibility spike** (§16).

1. **Stock ASUSWRT has no official API.** Control uses the same unofficial HTTP(S) endpoints the WebUI uses: `appGet.cgi` (reads) and `applyapp.cgi` (writes), authenticated via an `asus_token` cookie. Hooks/payloads can change between firmware versions, so the router layer must be isolated behind an adapter (§5.3).
2. **Domain visibility is domain-level only.** Because nearly all traffic is HTTPS, the network can observe the **destination domain** (via DNS / TLS SNI) but **not** full URLs, page content, or in-session activity. "Domains traversed" = `youtube.com`, not which video.
3. **Stock web history is weak for an app** — it requires Trend Micro data-collection consent and is wiped on reboot. NetWarden therefore sources domain telemetry from a **pluggable telemetry provider** (§5.4), with **NextDNS recommended** (per-device profiles + query-log API), or Merlin's on-device SQLite as an alternative.
4. **"Time spent per domain" is not directly measurable.** DNS logs give timestamps and counts, not dwell time. NetWarden defines an **estimated active time** model (§9 / §7.6) rather than claiming literal seconds.
5. **MAC randomisation & DoH reduce fidelity.** Devices using private/random MACs may appear as multiple/unknown entries; devices using DNS-over-HTTPS bypass the resolver and won't appear in domain telemetry unless DoH is forced/blocked. Treated as known limitations (§14).

---

## 5. System Architecture

```
                         ┌──────────────────────────────┐
                         │  NetWarden (Next.js, mobile)  │
                         │  hazo_ui screens + hazo_admin │
                         │  hazo_api route handlers      │
                         └───────────────┬──────────────┘
                                         │
   ┌──────────────┬──────────────┬──────┴───────┬──────────────┬──────────────┐
   │ hazo_auth    │ hazo_connect │ hazo_jobs    │ hazo_audit   │ hazo_notify  │
   │ (authn/authz)│ (SQLite DB)  │ (schedules + │ (block trail)│ (Telegram /  │
   │              │ + hazo_state │  pollers)    │              │  alerts)     │
   └──────────────┴──────┬───────┴──────┬───────┴──────────────┴──────────────┘
                         │              │
              ┌──────────▼───┐   ┌──────▼───────┐
              │ RouterProv.  │   │ TelemetryP.  │   ← NetWarden-OWNED adapters
              │ (ASUSWRT)    │   │ (NextDNS…)   │     (secrets via hazo_secure)
              └──────┬───────┘   └──────┬───────┘
                     │                  │
              ┌──────▼──────┐    ┌──────▼──────┐
              │ ZenWiFi AX  │    │ DNS logs    │
              │ appGet/apply│    │ per-device  │
              └─────────────┘    └─────────────┘
```

### 5.1 Components
- **Web app (Next.js, App Router):** mobile-first UI built from `hazo_ui` components; admin/settings screens via `hazo_admin`; API route handlers via `hazo_api`. Runs server-side on the VPS or a LAN box that can reach the router.
- **Persistence:** `hazo_connect` (SQLite local / PostgreSQL production) for all relational state in `app_*` tables; `hazo_state` for the volatile/TTL-bearing block reconciliation state and ephemeral settings.
- **Background work:** all pollers and the schedule executor run as `hazo_jobs` (maintenance jobs for sync/ingest/rollup; scheduled jobs for block/unblock).
- **Cross-cutting:** `hazo_core` (errors, correlation ID, config loader, utils), `hazo_logs` (structured logs), `hazo_env` (env resolution), `hazo_secure` (router & telemetry secrets), `hazo_audit` (immutable action trail), `hazo_notify` (alerts).

### 5.2 hazo Package Reuse Map (authoritative)

This is the heart of v2. Each NetWarden concern is satisfied by an existing package; bespoke code is the exception, not the rule.

| NetWarden concern | Package | What we reuse instead of building | Notes / scope |
|---|---|---|---|
| Auth, roles, sessions, first-superadmin | **hazo_auth** | Login, role resolution, scoped role strings, session helpers | Gates login + who is superadmin (§6.1) |
| Errors, correlation ID, INI config loader, utils | **hazo_core** | `HazoError`, correlation-ID propagation, `loadConfig`, `generateId`, `safeJsonParse` | Peer dep of every hazo package |
| Structured logging | **hazo_logs** | File + console logger; `env` on every entry | Via `hazo_core/logger` |
| Config files | **hazo_config** + **hazo_env** | INI parsing; typed env names; per-env DB/file/secret config; `doctor` CLI | `HAZO_ENV` convention |
| Relational persistence | **hazo_connect** | `createCrudService()`, query builders, `DbResult<T>`, dual SQLite/Postgres | Replaces all hand-written CRUD |
| Volatile / TTL state + reconciliation | **hazo_state** | Transactional KV with TTL, optimistic CAS, atomic helpers | Block reconcile state, in-flight job markers (§7.4) |
| HTTP API surface | **hazo_api** | `ok`/`fail` envelopes, error codes, Zod→OpenAPI 3.1 + Swagger UI, `withRequestContext`, rate limiting | Every NetWarden route |
| Secrets at rest | **hazo_secure** | Router credentials & telemetry API-key handling, security headers | Replaces "encrypt in app_settings" handwave (§13) |
| Immutable action audit | **hazo_audit** | Audit-trail capture for every block/unblock | Replaces custom `app_block_audit` logic (§8) |
| File upload/storage/validation | **hazo_files** | Group/person image upload, type & size validation | Replaces `image_path` raw handling (§7.3) |
| Image processing | **hazo_images** | Avatar resize / thumbnail / format normalisation | Optional but recommended for person photos |
| Background jobs + schedules | **hazo_jobs** | One-shot timers, recurring schedules, **and** sync/ingest/rollup maintenance jobs | Replaces all custom workers (§11) |
| Notifications | **hazo_notify** | Telegram (`hazo_notify/adapters/telegram`), inbox, push | Alerts for job/sync failures (v1), block/new-device events (v2) |
| Admin shell + panels | **hazo_admin** | Auth-gated `/admin` preset, panel kit, users/requests/grants screens | Replaces bespoke Admin screen scaffolding (§10.8) |
| Charts / analytics rendering | **hazo_dataviz** | Headless data-viz primitives for trend charts & breakdowns | Replaces ad-hoc chart code (§7.6, §10.7) |
| UI components + hooks + test harness | **hazo_ui** | shadcn/ui components, Tailwind preset, `useDebounce`/`useViewport`, `hazo_ui/test-harness`, `/autotest` | Every screen |
| Test infrastructure | **hazo_testing** | SQLite test DB, `apiTestClient`, auth factories, fixtures, Jest preset | Used heavily in the Phase 1 spike |

**Optional / future (named so they aren't reinvented later):**

| Concern | Package | When |
|---|---|---|
| App's own product analytics + feature flags | **hazo_umetrics** | Phase 9+, to gate risky features behind flags and measure NetWarden usage (distinct from *network* analytics) |
| Per-device free-text notes as first-class entities | **hazo_notes** | If device notes outgrow a plain column |
| Export analytics as PDF reports | **hazo_pdf** | v2 reporting |
| Contextual in-app help for low-fidelity/empty states | **hazo_ihelp** | Polish phase |
| In-app user feedback | **hazo_feedback** | Polish phase |
| Dev-only debug panel | **hazo_debug** | Throughout dev |

> **Principle:** Before writing any new helper in NetWarden, check this table and the workspace ecosystem map first. If a `hazo_*` package covers it, use it; if it *almost* covers it, file a feature request into that package (per the workspace "Filing feature requests" convention) rather than forking the behaviour into NetWarden.

### 5.3 RouterProvider (adapter — NetWarden-owned)
Interface so the router is swappable and firmware churn is contained:
```ts
interface RouterProvider {
  listClients(): Promise<RouterClient[]>          // mac, ip, hostname, band, rssi, online
  blockDevice(mac: string): Promise<void>         // "Block Internet Access"
  unblockDevice(mac: string): Promise<void>
}
```
- **v1 implementation:** `AsusWrtProvider` — login → `asus_token`; `appGet.cgi` hook `get_clientlist()` for reads; `applyapp.cgi` writes for the network-map internet block. Server-side only (router uses self-signed cert; never call from the browser).
- **Secrets:** router host/user/password come from `hazo_secure`, not from a plaintext settings row. Errors raised as `HazoError` subclasses (`hazo_core`) and logged via `hazo_logs`.

### 5.4 TelemetryProvider (adapter — NetWarden-owned)
```ts
interface TelemetryProvider {
  getDomainEvents(sinceTs: number): Promise<DomainEvent[]>  // {deviceKey, domain, ts}
  resolveDeviceKey(event): mac | null                       // map provider identity → MAC
}
```
- **Recommended:** `NextDnsProvider` — each device → its own NextDNS profile; pull the query log via NextDNS API. Clean per-device attribution and an actual documented API. API key via `hazo_secure`.
- **Alternative:** `MerlinSqliteProvider` — read the on-device web-history SQLite over SSH (requires Asuswrt-Merlin).
- **Fallback:** `AsusWebHistoryProvider` — limited; documents the constraint.

---

## 6. Integrations (contracts to confirm in Phase 1)

### 6.1 hazo_auth
Follows the established hazo_* conventions:
- **Config:** `.ini` file via `hazo_config` / `hazo_core` `loadConfig`.
- **Cookies:** prefix resolved via the package's cookie-name helper / `BASE_COOKIE_NAMES`.
- **Roles:** scoped role strings `{package}:{appId}:{role}`:
  - `netwarden:{appId}:superadmin`
  - `netwarden:{appId}:user` (or any authenticated subject treated as a user)
- **Server usage:** `hazo_api`'s `withRequestContext` + the `hazo_auth` server session helper resolve subject + roles for every API route and page; unauthenticated requests redirect to the hazo_auth login.

Fine-grained, per-group capabilities are **not** modelled as hazo_auth roles (too dynamic). `hazo_auth` gates *login* and *who is superadmin*; NetWarden's own `app_user_grants` table handles capability grants and the request/approve workflow (§7.1, §9), with the admin UI delivered by `hazo_admin`.

> **Phase 1 confirm:** exact server-side session helper name/signature, how to read roles for the current subject (mirror the `hazo_feedback`/`hazo_admin` inspection approach), and the first-superadmin provisioning path.

### 6.2 hazo_jobs
Used for **all** scheduled block/unblock actions (one-shot timers, future-dated blocks, recurring schedules) **and** the recurring maintenance pollers (sync, telemetry ingest, nightly rollup) — these are no longer hand-rolled workers.

**Assumed contract (confirm against the real package in Phase 1):**
```ts
hazo_jobs.schedule(type, runAt: Date, payload): jobId
hazo_jobs.scheduleRecurring(type, cron: string, payload): jobId
hazo_jobs.cancel(jobId): void
hazo_jobs.registerHandler(type, async (payload) => { ... })
// Requirement: jobs persist across process restarts and are re-armed on boot.
```

**Registered handlers:**
- `netwarden.unblock` → calls `RouterProvider.unblockDevice` (or each device in a group), updates block state (`hazo_state` + `app_block_state`), writes the audit entry via `hazo_audit`.
- `netwarden.block` → mirror, for future-dated/recurring blocks.
- `netwarden.sync` → device sync poller (recurring).
- `netwarden.ingest` → telemetry ingest (recurring).
- `netwarden.rollup` → nightly aggregation + retention prune (recurring).

**Flows:**
- *Block for 1h:* block now (router) → `schedule('netwarden.unblock', now+1h, {targetType, targetId})` → store `job_id` on `app_block_state`. Early manual unblock → `cancel(job_id)`.
- *Bedtime schedule:* `scheduleRecurring('netwarden.block', '0 21 * * *', …)` + `scheduleRecurring('netwarden.unblock', '0 7 * * *', …)`.

> **Phase 1 confirm:** exact method names, recurrence format (cron vs interval), persistence/re-arm guarantees, and failure/retry semantics.

### 6.3 hazo_audit
Every mutation (block/unblock, grant/revoke, schedule create/cancel) is captured via `hazo_audit` rather than a bespoke insert. NetWarden passes actor (subject id or `system`), action, target, source, and result; queries the trail for the device "audit history" view. This removes the need to maintain `app_block_audit` write/query logic by hand (the table, if retained, becomes a thin `hazo_audit`-backed projection — confirm in Phase 1 whether `hazo_audit` owns its own table).

### 6.4 hazo_secure
Router credentials and telemetry API keys are stored and retrieved through `hazo_secure` (secrets handling), and `hazo_secure` security headers are applied to the app. No secret is ever written to `app_settings` in plaintext or sent to the browser.

### 6.5 hazo_files + hazo_images
Group/person images are uploaded, validated (type, size) and stored via `hazo_files`; `hazo_images` normalises/resizes them into avatar + thumbnail variants. The `app_groups.image_path` column becomes a reference into the `hazo_files` store.

### 6.6 hazo_notify
Operational alerts (sync failure, job failure, telemetry gaps) go out via `hazo_notify` using the Telegram adapter, reusing the household's existing bot. v2 event notifications (block fired, new device joined) ride the same path.

---

## 7. Functional Requirements

### 7.1 Authorisation & permission model
- Any authenticated subject can **view** everything (explore, drill-down, analytics).
- **Mutations** (`device.block`, `device.unblock`, `group.block`, `group.unblock`, `schedule.create`, `schedule.cancel`) require a matching **capability grant** in `app_user_grants`, optionally **scoped** to a specific group (`scope_type = global | group`).
- **Request/approve workflow:** a user submits an access request (`app_access_requests`) for a capability (+ optional group scope). A superadmin **approves** (creates/activates a grant) or **declines**. Superadmins may also grant directly without a request. The admin surface for this is built on `hazo_admin`.
- Superadmins may **revoke** any grant.
- Every mutation is checked server-side (in a shared `hazo_api` guard) against grants **and** recorded via `hazo_audit`.

### 7.2 Device discovery & identity
- `netwarden.sync` (`hazo_jobs` recurring, default 60s) calls `RouterProvider.listClients()` and upserts `app_devices` (keyed by MAC) via `hazo_connect`.
- New devices are flagged `is_new = 1` until acknowledged.
- Editable per device: friendly name, icon, notes, primary group.
- **MAC randomisation:** devices with rotating MACs may appear multiple times; v1 surfaces them as-is and notes it; a manual "merge into logical device" is a future enhancement (§15).

### 7.3 Groupings
- Create/edit/delete manual groups: name, description, **image** (via `hazo_files`/`hazo_images`; person photos supported), `type = person | generic`, colour.
- A device may belong to multiple groups (join table); UI highlights a device's **primary group**.
- Group actions: **Block all** / **Unblock all** members (capability-gated; honours per-group scope), with the same timer/schedule options as a single device.

### 7.4 Blocking with timers & schedules
- Per device and per group: **Block now**, **Unblock now**.
- **Timer options:** block for 15m / 30m / 1h / 2h / custom; or **until** a specific time. Backed by a one-shot `hazo_jobs` unblock.
- **Schedules:** future-dated block, and **recurring** windows (e.g. nightly). Managed/listed/cancellable in a Schedules screen.
- Block state is **idempotent & reconciled**: intended state is held in `app_block_state` (`hazo_connect`) with the live/desired marker in `hazo_state` (TTL + optimistic CAS to avoid double-apply races); the sync job compares intended vs the router's actual state and re-applies or flags drift.
- Group block = iterate members; partial failures are recorded per device (audited via `hazo_audit`) and surfaced.

### 7.5 Domain drill-down (per device)
- Device detail shows: **top domains** (by query volume) for a selected range, a **recent domains** timeline, and **first/last seen** per domain.
- Sourced from `TelemetryProvider` → `app_domain_events` → `app_domain_rollup_daily` (all via `hazo_connect`).
- Clear empty/low-fidelity states (use `hazo_ihelp` for the explanatory copy) when a device uses DoH or no telemetry provider is configured.

### 7.6 Analytics
- **Per device — time spent:** derived from **presence** (online intervals from the sync job), accumulated per day/hour → `app_device_presence`. Genuine connected-time.
- **Per domain — estimated active time:** since dwell time isn't measurable, define a **sessionisation model**: queries to a domain for a device are grouped into sessions where the gap between consecutive queries < `SESSION_GAP` (default 5 min); estimated active time = sum of session spans (with a minimum per-session floor, default 1 min). Presented explicitly as an **estimate**, alongside the hard metric **query count**.
- Views: per-device breakdown (top domains by est. time and by count), per-group rollups, date-range selector, trend charts — all rendered with `hazo_dataviz` primitives.

### 7.7 Explore interface (mobile-first)
- Segmented toggle: **Groups** | **Devices** (`hazo_ui` components).
- Groups: card grid with images, member count, online count, block status; "Block all" on the card and in detail.
- Devices: searchable/filterable list (`useDebounce` from `hazo_ui`) with status chips (online / offline / blocked) and group badge.
- Bottom navigation: **Explore · Schedules · Analytics · Admin** (Admin shown to superadmin only).

---

## 8. Data Model (SQLite via hazo_connect, `app_` prefix)

> `hazo_auth` owns identity. NetWarden references the `hazo_auth` **subject id** as a string; it does not duplicate the user table. All tables are managed through `hazo_connect` (`createCrudService`), follow the dual SQLite/PostgreSQL conventions, and use migrations in `migrations/`. Where a `hazo_*` package owns its own storage (`hazo_audit`, `hazo_files`, `hazo_jobs`, `hazo_state`, `hazo_secure`), NetWarden **does not** duplicate that table — the entries below marked *(thin / provider-owned)* defer to the package.

```sql
-- Devices known to the app (keyed by MAC)
app_devices (
  id INTEGER PRIMARY KEY,
  mac TEXT UNIQUE NOT NULL,
  hostname TEXT,
  friendly_name TEXT,
  vendor TEXT,
  icon TEXT,
  notes TEXT,
  current_ip TEXT,
  last_band TEXT,
  status TEXT,                 -- online | offline | blocked
  is_new INTEGER DEFAULT 1,
  first_seen INTEGER,
  last_seen INTEGER,
  primary_group_id INTEGER     -- FK app_groups.id (nullable)
);

-- Manual groups (often a person)
app_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'generic', -- person | generic
  image_file_id TEXT,          -- reference into hazo_files (was image_path)
  color TEXT,
  created_by TEXT,             -- hazo_auth subject id
  created_at INTEGER
);

app_group_members (
  group_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  added_by TEXT,
  added_at INTEGER,
  PRIMARY KEY (group_id, device_id)
);

-- Current intended block state per device (live/desired marker mirrored in hazo_state)
app_block_state (
  device_id INTEGER PRIMARY KEY,
  is_blocked INTEGER DEFAULT 0,
  blocked_by TEXT,
  blocked_at INTEGER,
  reason TEXT,                 -- manual | scheduled | group:{id}
  scheduled_unblock_at INTEGER,
  unblock_job_id TEXT,         -- hazo_jobs jobId
  router_synced INTEGER DEFAULT 0
);

-- Scheduled / recurring block-unblock actions (job_id is the hazo_jobs handle)
app_schedules (
  id INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL,   -- device | group
  target_id INTEGER NOT NULL,
  action TEXT NOT NULL,        -- block | unblock
  run_at INTEGER,              -- one-shot epoch (nullable if recurring)
  cron TEXT,                   -- recurring expr (nullable if one-shot)
  job_id TEXT,                 -- hazo_jobs jobId
  status TEXT DEFAULT 'active',-- active | done | cancelled
  created_by TEXT,
  created_at INTEGER
);

-- Block/unblock audit  *(thin / provider-owned: prefer hazo_audit; see §6.3)*
-- Retained only if a NetWarden-local projection is needed for fast device-history queries.

-- Capability grants (fine-grained, app-managed)
app_user_grants (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  capability TEXT NOT NULL,    -- device.block | device.unblock | group.block | group.unblock | schedule.create | schedule.cancel
  scope_type TEXT DEFAULT 'global', -- global | group
  scope_id INTEGER,
  status TEXT DEFAULT 'active',-- active | revoked
  granted_by TEXT,
  granted_at INTEGER,
  UNIQUE (subject, capability, scope_type, scope_id)
);

-- Access requests awaiting superadmin decision
app_access_requests (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope_type TEXT DEFAULT 'global',
  scope_id INTEGER,
  note TEXT,
  status TEXT DEFAULT 'pending',-- pending | approved | declined
  decided_by TEXT,
  decided_at INTEGER,
  created_at INTEGER
);

-- Raw domain telemetry (retention-limited, e.g. 30 days)
app_domain_events (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_dev_dom_ts ON app_domain_events(device_id, domain, ts);

-- Daily per-device per-domain rollup
app_domain_rollup_daily (
  device_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  day TEXT NOT NULL,           -- YYYY-MM-DD
  query_count INTEGER,
  first_seen INTEGER,
  last_seen INTEGER,
  est_active_minutes INTEGER,
  PRIMARY KEY (device_id, domain, day)
);

-- Device presence for "time spent on device"
app_device_presence (
  device_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  connected_minutes INTEGER,
  PRIMARY KEY (device_id, day)
);
```

**Removed from v1's model (now provider-owned):**
- `app_settings` secrets → `hazo_secure` (non-secret app settings can use `hazo_state` or a small `app_settings` KV; **no credentials**).
- `app_block_audit` write/query logic → `hazo_audit`.
- Group `image_path` blob handling → `hazo_files`.

---

## 9. Permissions matrix

| Capability | Default user | Granted user | Superadmin |
|------------|:---:|:---:|:---:|
| View explore / device / group / analytics | ✅ | ✅ | ✅ |
| Request a capability | ✅ | ✅ | ✅ |
| `device.block` / `device.unblock` | ❌ | ✅ (if granted, in scope) | ✅ |
| `group.block` / `group.unblock` | ❌ | ✅ (if granted, in scope) | ✅ |
| `schedule.create` / `schedule.cancel` | ❌ | ✅ (if granted) | ✅ |
| Approve/decline access requests | ❌ | ❌ | ✅ |
| Grant/revoke capabilities | ❌ | ❌ | ✅ |
| Create/edit groups & images | ❌ | (configurable) | ✅ |
| Configure router / telemetry / settings | ❌ | ❌ | ✅ |

---

## 10. Screens / UX (mobile-first)

Built from `hazo_ui` components; admin/settings via `hazo_admin`; charts via `hazo_dataviz`.

1. **Login** — `hazo_auth`.
2. **Explore** — Groups | Devices toggle; bottom nav.
3. **Group detail** — image, members, Block all / Unblock all (timer modal), group analytics summary, group schedules.
4. **Device detail** — info; block toggle + timer/schedule modal; domain drill-down (top + recent + timeline); analytics (time on device, top domains by est. time & count); audit history (from `hazo_audit`).
5. **Block-with-timer modal** — now / for N / until time / recurring.
6. **Schedules** — active & upcoming one-shot + recurring; edit/cancel.
7. **Analytics** — per-device & per-domain; date range; trend charts (`hazo_dataviz`).
8. **Admin (superadmin)** — `hazo_admin` shell: users, pending requests (approve/decline), grant/revoke, scope to groups.
9. **Settings (superadmin)** — router connection, telemetry provider, poll/retention intervals (secrets via `hazo_secure`).

UX notes: touch-first targets, status chips, optimistic UI on block with reconcile, PWA-installable, clear low-fidelity/empty states (`hazo_ihelp`) when telemetry is unavailable.

---

## 11. Background jobs / workers (all via hazo_jobs)

v1 described custom workers; v2 makes them `hazo_jobs` so they get persistence, re-arm, and retry semantics for free.

| Job (`hazo_jobs` type) | Trigger | Work |
|--------|---------|-----|
| `netwarden.sync` | recurring, every 60s (configurable) | `listClients()` → upsert `app_devices`, update presence, detect new, reconcile block drift |
| `netwarden.ingest` | recurring, every 1–5 min | `getDomainEvents(since)` → `app_domain_events` |
| `netwarden.rollup` | recurring, daily (off-peak AEST) | aggregate events → `app_domain_rollup_daily`; presence → `app_device_presence`; prune raw events past retention |
| `netwarden.block` / `netwarden.unblock` | one-shot + recurring | run the router action; update state; audit; re-armed on boot |

Failures surface via `hazo_notify` (Telegram).

---

## 12. Non-functional requirements
- **Mobile-first & responsive**; PWA-installable; works well one-handed.
- **Server-side only** for router/telemetry calls; secrets via `hazo_secure`, never to the client.
- **Persistence** through `hazo_connect` (SQLite WAL locally, Postgres-ready); retention policy for raw telemetry (default 30 days, then aggregated only) enforced by `netwarden.rollup`.
- **Resilience:** schedules + pollers survive restarts (re-armed by `hazo_jobs`); block state reconciled against the router; per-device error capture on group actions.
- **Observability:** structured logs (`hazo_logs`) with correlation IDs (`hazo_core`); `env` on every entry (`hazo_env`).
- **Deploy** alongside existing Hazo VPS infra or on a LAN box with router reachability; `hazo_notify` Telegram alerting for sync/job failures.

---

## 13. Security & privacy
- Router credentials and telemetry API keys handled by `hazo_secure` (encrypted at rest); never exposed to the browser. Security headers applied via `hazo_secure`.
- App behind `hazo_auth`; HTTPS in front; rate limiting on mutation routes via `hazo_api`.
- Every mutation audited immutably via `hazo_audit`.
- **Household transparency:** groups can represent real people (incl. children). The PRD recommends an explicit acknowledgement that this monitors household members, age-appropriate use, and a documented data-retention window. Consider a per-group "monitoring on/off" flag for adults' devices.

---

## 14. Known limitations
- MAC randomisation may fragment a device into several entries (logical-merge is future, §15).
- DoH-enabled devices bypass the resolver and won't appear in domain telemetry unless DoH is forced/blocked.
- "Time spent per domain" is an explicit **estimate** (sessionisation), not measured dwell time.
- Router control rides unofficial endpoints; firmware updates can change payloads (contained by the `RouterProvider` adapter).

---

## 15. Out of scope / future
- **Per-device per-domain blocking** (block `example.com` only for this device): not in stock ASUS; delivered via the DNS layer — Merlin **DNSFilter** per-device resolver, or **NextDNS per-device denylists** (API-driven). Natural v2, reuses the TelemetryProvider relationship.
- **Logical device merge** for MAC-randomised devices.
- **DoH handling** (force/redirect or block) to restore telemetry fidelity.
- **Event notifications** (push/Telegram) on block events, new-device joins, schedule fires — via `hazo_notify`.
- **Per-user view scoping** (restrict which groups a non-admin can see).
- **PDF analytics export** via `hazo_pdf`; **feature flags / product analytics** via `hazo_umetrics`.

---

## 16. Phased delivery — feasibility first

> The single biggest risk is that the unofficial ASUSWRT control path, the telemetry attribution, or the assumed `hazo_jobs`/`hazo_auth` contracts don't behave as hoped. **Phase 1 exists to prove those before we commit to a full build.** No production UI is built in Phase 1; it is throwaway-or-thin spike code with a hard go/no-go gate.

### Phase 1 — Technical feasibility spike (de-risk, then decide)

**Objective:** prove every load-bearing unknown end-to-end against the *real* ZenWiFi AX and the *real* hazo packages. Output is a **feasibility report + go/no-go recommendation**, not a product.

**Work items**
1. **Router read path.** Stand up `AsusWrtProvider.listClients()` against the live router: login → `asus_token`, `appGet.cgi` `get_clientlist()`. Confirm we get MAC/IP/hostname/band/online reliably, and how the session/token expires.
2. **Router write path.** Implement `blockDevice`/`unblockDevice` via `applyapp.cgi` for the network-map "Block Internet Access". Verify it actually cuts/restores access, and critically **whether it survives a router reboot** (drives reconcile design).
3. **Telemetry attribution.** With `NextDnsProvider`, prove per-device domain events can be pulled via the NextDNS API and mapped back to a MAC (`resolveDeviceKey`). Measure freshness/lag (informs ingest interval and "currently on X" feasibility).
4. **hazo_jobs contract.** Register a one-shot and a recurring handler; **kill the process and restart** to confirm persistence + re-arm; observe retry/failure semantics. Lock the real method names/signatures.
5. **hazo_auth contract.** Resolve subject + roles server-side using the real session helper; provision the first superadmin; confirm scoped-role strings. Lock the real signatures.
6. **Persistence + secrets smoke test.** Wire `hazo_connect` (SQLite) with one or two `app_*` tables and `hazo_secure` for the router/NextDNS credentials, to confirm the foundation libraries integrate cleanly in a Next.js server context. Use `hazo_testing` (`apiTestClient`, SQLite test DB, auth factories) for the harness.

**Phase 1 deliverables**
- A short **feasibility report** answering each §16 work item with: works / works-with-caveats / blocked, plus measured numbers (token lifetime, block-apply latency, reboot survival, telemetry lag).
- A **confirmed contracts appendix** replacing the "assumed contract" guesses in §6 with the real `hazo_jobs` / `hazo_auth` signatures.
- A thin spike repo (CLI or `/autotest`-style harness) — **not** the production app.

**Go/no-go gate (exit criteria):**
- **GO** if router read+write work and survive reboot (or a viable reconcile path is proven), telemetry gives usable per-device attribution, and `hazo_jobs`/`hazo_auth` contracts are confirmed.
- **CONDITIONAL GO / re-scope** if (e.g.) NextDNS attribution is weak (fall back to Merlin, or descope domain analytics to v2) or block doesn't survive reboot (lean harder on reconcile).
- **NO-GO / rethink** if the router write path can't be driven reliably on current firmware — the core value prop fails and we reconsider approach (e.g. Merlin-only, or a different control mechanism).

### Phase 2 — Foundations (only after GO)
Next.js app scaffolded per the workspace standard (`test-app/`, `/autotest` on `hazo_ui/test-harness`, Tailwind v4 `@source` wiring). `hazo_connect` migrations for the `app_*` tables; `hazo_auth` wired (login, roles, first superadmin); `hazo_api` route foundation (envelopes, OpenAPI, rate limiting); `hazo_secure` for credentials; `hazo_env`/`hazo_config` for config; Settings screen skeleton.

### Phase 3 — RouterProvider + device sync
Productionise `AsusWrtProvider`; `netwarden.sync` job (`hazo_jobs`); `app_devices` + presence; Explore (Devices) screen.

### Phase 4 — Blocking core
Device block/unblock through `hazo_api` routes; `app_block_state` (+ `hazo_state` reconcile markers); audit via `hazo_audit`; drift reconcile in `netwarden.sync`.

### Phase 5 — Permissions
`app_user_grants`, access-request/approve workflow, superadmin **Admin** screen on `hazo_admin`, mutation gating in a shared `hazo_api` guard.

### Phase 6 — Groups & images
Group CRUD; membership; images via `hazo_files` + `hazo_images`; Explore (Groups); Block-all.

### Phase 7 — Timers & schedules
`hazo_jobs` one-shot + recurring; timer modal; Schedules screen.

### Phase 8 — Telemetry + drill-down
Productionise `TelemetryProvider` (NextDNS); `netwarden.ingest`; rollups; device domain views; low-fidelity states (`hazo_ihelp`).

### Phase 9 — Analytics
Presence time + domain sessionisation estimates; charts via `hazo_dataviz`; optional feature-flagging/usage analytics via `hazo_umetrics`.

### Phase 10 — Polish
PWA, empty/low-fidelity states, `hazo_notify` alerting, retention pruning, optional `hazo_feedback` / `hazo_pdf` export.

---

## 17. Assumptions to confirm — now folded into Phase 1
1. **hazo_jobs API** — method names, recurrence format, persistence/re-arm, retry semantics → Phase 1 item 4.
2. **hazo_auth server session helper** — signature for subject + roles; first-superadmin path → Phase 1 item 5.
3. **Telemetry provider choice** — NextDNS vs Merlin vs stock; attribution quality → Phase 1 item 3.
4. **Router block semantics** — exact `applyapp.cgi` payload on current firmware and reboot survival → Phase 1 items 1–2.
5. **Real-time vs end-of-day** domain data — ingest interval; whether live "currently on X" is feasible → Phase 1 item 3.
6. **hazo_audit / hazo_state / hazo_files ownership** — confirm each package owns its own storage so NetWarden doesn't duplicate tables → Phase 1 item 6.
