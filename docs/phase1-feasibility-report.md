# Phase 1 Feasibility Report — NetWarden Router + Telemetry Spike

**Status:** Skeleton — hardware sections pending supervised spike session.
**Last updated:** 2026-06-20

---

## Overview

This report documents the findings from the Phase 1 feasibility spike for NetWarden's
router control and telemetry attribution layers. It is divided into:

- **§§1–4** — hardware-dependent sections (router read/write/reboot, telemetry), filled
  during the supervised spike session with a live ASUS ZenWiFi router.
- **§5** — open product decisions that must be resolved before Phase 4+.
- **§6** — confirmed hazo_* library contracts (proven by scripts/spike-jobs.mjs — no hardware needed).

---

## §1 — Router Read Path (get_clientlist)

### To verify (supervised)

- [ ] POST /login.cgi with `login_authorization=<base64(user:pass)>` returns `asus_token` in the JSON body.
- [ ] GET /appGet.cgi?hook=get_clientlist() returns JSON with a `get_clientlist` string field.
- [ ] Document the exact delimiter and field order in the raw client list string:
  - Suspected format: `<MAC><IP><Name><Connected><Band><Vendor>;...`
  - Confirm whether semicolons, newlines, or another delimiter is used on ZenWiFi firmware.
  - Confirm the field count (some firmware variants have extra fields).
- [ ] Confirm the `connected` field value semantics ("1"/"0" vs "true"/"false").
- [ ] Confirm the `band` field values ("2G"/"5G"/"6G" vs "2.4GHz"/"5GHz").
- [ ] Confirm the session token TTL: assumed ~30 min — does the router return an explicit expiry?
- [ ] Confirm the `asus_token` is sufficient for subsequent requests (no CSRF header needed?).
- [ ] Document the HTTP status code returned for an expired/invalid token (for re-auth logic).

### Findings

> _Fill in during the supervised spike session. Paste raw response excerpts here._

- Token acquired at: _(timestamp)_
- Token TTL (observed): _(seconds or "unknown — no expiry in response")_
- Raw get_clientlist value (excerpt): _(paste first ~200 chars)_
- Confirmed delimiter: _(`; ` / `\n` / other)_
- Confirmed field order: _(MAC, IP, Name, Connected, Band, Vendor — or note differences)_
- Number of clients returned: _N_
- Edge cases observed: _(e.g. offline devices, wired clients, guest network clients)_

---

## §2 — Router Write / Block Path (set_client_state)

### To verify (supervised)

- [ ] POST /applyapp.cgi with `hook=set_client_state(<mac>,0,<mac>,)` blocks internet access for SPIKE_TEST_MAC.
- [ ] The guinea-pig device loses internet connectivity within _(expected delay)_ seconds.
- [ ] POST /applyapp.cgi with `hook=set_client_state(<mac>,1,<mac>,)` restores internet access.
- [ ] The guinea-pig device regains internet connectivity within _(expected delay)_ seconds.
- [ ] Document the exact hook argument format that works on this firmware version:
  - 2-arg: `set_client_state(<mac>,<flag>)` ?
  - 4-arg: `set_client_state(<mac>,<flag>,<cut_mac>,<group>)` ?
- [ ] Document the response body format for a successful state change.
- [ ] Document the response body format for an error (e.g. invalid MAC, invalid token).
- [ ] Confirm the block applies only to internet access (not LAN access).
- [ ] Confirm the block is visible in the router's web UI (Parental Controls or similar).

### Findings

> _Fill in during the supervised spike session._

- Hook format that worked: `set_client_state(___)`
- Response body on success: _(paste)_
- Response body on failure: _(paste if tested)_
- Block latency (API call → device loses internet): _~N seconds_
- Unblock latency: _~N seconds_
- Block visible in router UI at: _(menu path)_
- Notes on the block mechanism: _(NVRAM var name if discoverable, e.g. `MULTIFILTER_ALL`)_

---

## §3 — Reboot Survival

> **This is a MANUAL step.** See scripts/spike-router.mjs Step 4 for instructions.

### To verify (supervised — manual)

- [ ] Block SPIKE_TEST_MAC via set_client_state.
- [ ] Trigger a router reboot (via UI or POST /applyapp.cgi hook=reboot).
- [ ] Wait ~60 seconds for the router to come back online.
- [ ] Call get_clientlist and confirm SPIKE_TEST_MAC is still in the blocked state.
- [ ] Attempt internet access from the guinea-pig device to confirm the block is enforced.
- [ ] Document whether the block is stored in NVRAM (persists) or RAM (lost on reboot).

### Findings

> _Fill in after the manual reboot-survival test._

- Block persists across reboot: _(YES / NO / PARTIAL — explain)_
- If NO: reconcile strategy required in Phase 4:
  - On router reconnect → query get_clientlist, compare against app_block_state,
    re-apply any blocks that were lost. Adds complexity to the sync/reconcile job.
- If YES: no reconcile needed at boot; only reconcile on out-of-sync errors.
- Notes: _(anything unexpected)_

### Impact on Phase 4 design

> _Pending findings above. Placeholder for the reconcile strategy decision._

---

## §4 — Telemetry Attribution

> **Provider undecided.** NextDNS is preferred but not set up. This section is
> PENDING a product decision and a supervised session with the chosen provider.

### Open decisions (see §5)

- [ ] Which DNS provider will be used? (NextDNS preferred / Merlin firmware / stock ASUS history)
- [ ] If NextDNS: obtain an API key and profile ID, set NEXTDNS_API_KEY in the environment.
- [ ] If Merlin: evaluate availability of per-client DNS logging via dnsmasq.
- [ ] Document the per-device attribution method (IP → MAC resolution source).

### To verify (supervised — after provider decision)

- [ ] Provider returns per-client (by IP) DNS query logs.
- [ ] IP → MAC mapping is reliable across DHCP lease renewals.
- [ ] Rate limits / API quotas are acceptable for the polling cadence needed.
- [ ] Domain names only — no full URLs exposed (privacy constraint).
- [ ] Latency from a DNS query to it appearing in the API: _~N minutes_.
- [ ] Historical data retention: _N days_.

### Findings

> _Fill in after provider decision and telemetry spike._

- Provider chosen: _(NextDNS / Merlin / other)_
- API base URL: _
- Auth method: _
- Attribution method: _(IP from DNS query log → MAC via router client list)_
- Rate limits: _
- Retention: _
- Notes: _

---

## §5 — Open Product Decisions

These items are unresolved and block later phases. Each has an owner action.

| Decision | Status | Notes |
|---|---|---|
| Telemetry provider | **OPEN** | NextDNS preferred but API key not set up. Blocks Phase 8 (telemetry ingest). Set NEXTDNS_API_KEY and confirm profile ID before any telemetry work. |
| Reboot-survival (block persistence) | **UNPROVEN** | Must be confirmed during the supervised spike. Drives the Phase 4 reconcile strategy design. |
| Hook argument format for set_client_state | **UNVERIFIED** | 2-arg vs 4-arg — verify against live firmware. AsusWrtProvider.ts uses 4-arg; update if wrong. |
| Token TTL and refresh strategy | **UNVERIFIED** | Assumed 30 min. Determine if the router sends an explicit expiry, or if we need to probe. |

---

## §6 — Confirmed hazo Contracts

These contracts are **PROVEN** by scripts/spike-jobs.mjs (pure software — no hardware required, PASS confirmed).

### hazo_jobs — confirmed method signatures and behavior

```
hazo_jobs (proven by scripts/spike-jobs.mjs — PASS, re-arm across real child-process restart):
- createJobsClient({ connect: { adapter }, dialect: 'sqlite' }); adapter shape is { raw(sql, values?): Promise<any[]> }, NOT a HazoConnectAdapter.
- The raw() adapter MUST branch on better-sqlite3 stmt.reader (NOT a SQL-prefix heuristic): .all() throws on non-RETURNING writes, which the scheduler uses to promote scheduled->pending (the error is swallowed, so jobs silently never fire). hazo_jobs itself is correct.
- submit({ type, description (REQUIRED), payload, maxAttempts?, runAt?: ISO8601 }) -> { jobId }. A future runAt => status 'scheduled', promoted to 'pending' by the scheduler tick.
- jobs.schedules.create({ name, cron: '*/1 * * * *' (5-field), type, payload?, maxAttempts?, priority?, expiresInSec?, enabled? }) -> { id, next_run_at }.
- createScheduler({ adapter, dialect, tablePrefix?: 'hazo_jobs', scheduleTickMs? }) -> .start()/.stop()/.tickOnce(); promotes due scheduled jobs AND fires due recurring schedules.
- createWorker({ adapter, dialect, tablePrefix?, workerId, types: string[], pollMs?, concurrency? }).run(handler) / .stop(); claims status='pending' AND run_at<=now.
- DDL: applyDdl(adapter, ddlString) reading node_modules/hazo_jobs/db_setup_sqlite.sql (idempotent).
- Re-arm: scheduler.start() in a brand-new process re-arms purely from the persisted hazo_jobs / hazo_jobs_schedules tables — no in-memory state needed.
```

### Adapter shape (critical)

The raw() adapter MUST use `stmt.reader` (not a SQL-prefix heuristic) to distinguish reads from writes:

```js
// CORRECT — branch on better-sqlite3's stmt.reader property
raw(sql, values = []) {
  const stmt = db.prepare(sql);
  if (stmt.reader) {
    return Promise.resolve(stmt.all(...values));
  } else {
    stmt.run(...values);
    return Promise.resolve([]);
  }
}
```

Using a SQL-prefix heuristic (e.g. checking if sql starts with `SELECT`) fails silently because
the hazo_jobs scheduler uses non-SELECT RETURNING queries to promote scheduled→pending.

### hazo_auth, hazo_connect, hazo_secure

> Contracts confirmed by /autotest cases (Phase 2 foundations). See the autotest runner
> at /autotest for live results. No additional spike needed for these.

---

## Appendix — Spike Scripts

| Script | Purpose | Status |
|---|---|---|
| scripts/spike-jobs.mjs | hazo_jobs contract verification (pure software) | PASSED |
| scripts/spike-router.mjs | Live router API spike (hardware required) | STAGED — run in supervised session |

---

*End of Phase 1 Feasibility Report skeleton.*
*Fill in §§1–4 findings after the supervised spike session.*
