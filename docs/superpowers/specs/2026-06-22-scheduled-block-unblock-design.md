# Recurring block/unblock schedules with manual override

**Date:** 2026-06-22
**Status:** Implemented — 2026-06-22

## Goal

Let a user define recurring block/unblock schedules for a device or group, in
Melbourne time, and have those schedules coexist correctly with manual blocks
and unblocks. The motivating case: a device that is **blocked throughout the
day but unblocked from 4pm to 6pm** on selected days.

Manual actions take precedence over the schedule and **hold until the next
scheduled transition**, after which the schedule resumes control. Example:
device is blocked all day; user manually unblocks at 2pm; it stays unblocked;
at the 6pm scheduled block it re-blocks automatically.

## Engine choice: declarative policy + worker reconcile (Approach B)

Schedules are stored as a **declarative policy** (structured transition points),
not as one cron job per transition. The worker's existing poll loop computes,
each cycle, "what state should this device be in right now?" and reconciles the
router + DB to it.

Rejected alternative (Approach A — one cron job per transition) because it is
brittle for the cases that matter here: an offline device misses its transition
and is never corrected until the next day; manual-override "hold until next
transition" needs extra bookkeeping; process restarts can drop fires. The cron
jobs know *transitions* but never *"what the state should be right now,"* which
is exactly what the override logic and self-healing need.

Trade-off accepted: transition latency is bounded by the poll interval
(`SYNC_INTERVAL_SEC`, default 60s, tunable). Negligible for parental-control
windows.

## Data model

### New: `app_schedule_policies` (one policy per target)

| column | type | notes |
|---|---|---|
| `id` | PK | |
| `target_type` | text | `device` \| `group` |
| `target_id` | text | |
| `enabled` | int | 0/1 |
| `tz` | text | `Australia/Melbourne` |
| `label` | text | optional |
| `created_by` | text | |
| `created_at` | text | ISO |
| `updated_at` | text | ISO |

Unique on `(target_type, target_id)` — one policy per device/group keeps
"current desired state" unambiguous.

### New: `app_schedule_rules` (transition points making up a policy)

| column | type | notes |
|---|---|---|
| `id` | PK | |
| `policy_id` | FK | `app_schedule_policies.id` |
| `weekday` | int | 0=Mon … 6=Sun |
| `time_min` | int | 0–1439, minutes past local midnight in policy tz |
| `action` | text | `block` \| `unblock` |

A rule means "on this weekday at this local time, transition to this state."
State persists between transitions, so "blocked all day, allow 4–6pm Mon–Fri" =
10 rules (`unblock@16:00` + `block@18:00` on each of Mon–Fri). No rules are
needed to express the "blocked the rest of the day" baseline.

### Extend: `app_block_state`

Add `override_until` (ISO, nullable) — the instant a manual override expires.
Reuse existing `is_blocked` and `blocked_by`.

## Engine functions (pure, unit-tested, no I/O)

- `policyState(policy, nowISO) -> 'block' | 'unblock'`
  Expand rules onto a circular weekly timeline; the most recent transition
  at-or-before now gives the current desired state. Handles wrap-around (e.g.
  3am Tue → last transition was `block@18:00 Mon`).
- `nextTransition(policy, nowISO) -> ISO`
  The earliest transition strictly after now, as an absolute instant. Used to
  set `override_until` and to show "next change" in the UI.

All weekday/time math goes through `Intl.DateTimeFormat` in the policy's tz, so
DST is handled automatically (Melbourne AEST/AEDT). Melbourne and Sydney share
the same offsets and DST rules, so this is a relabel of existing tz behavior,
not a behavior change.

## Override semantics ("hold until next transition")

On **manual block/unblock** (`blockService.ts`):
- Set `is_blocked` to the manual value (as today).
- If the target has an **enabled policy**, stamp
  `override_until = nextTransition(now)` and `blocked_by = 'manual'`.
- If there is **no policy**, leave `override_until` null — today's behavior,
  unchanged.

**Reconcile decision** (computed per device, each poll):
- `override_until` set **and** `now < override_until` → honor manual state:
  `desired = is_blocked`.
- otherwise → `desired = policyState(now)`; if `override_until` had passed,
  clear it.

This makes the motivating scenario fall out automatically: blocked all day →
unblock at 2pm (`override_until` = today 18:00) → stays unblocked → at 6pm the
reconcile sees the override expired, recomputes policy = blocked, re-blocks.

A manual action **does not** cancel the policy (policies are not jobs). The
existing one-shot-timer cascade (manual unblock cancels a pending one-shot
re-block timer) is kept only for genuine one-shot timers.

## Worker reconcile changes (`runDeviceSync.ts`, Phase 2.5)

Today the "reapply" pass only re-asserts *blocks*. New behavior:

- **Policy-governed devices**: reconcile **both directions** to `desired`
  (block if desired & not blocked; unblock if not-desired & blocked), updating
  `app_block_state.is_blocked` and `blocked_by`.
- **Devices with no policy**: keep today's reapply-only behavior — never
  auto-unblock a manually-blocked, policy-less device.
- **Offline devices**: skipped this cycle and corrected when they return
  (self-healing — `setInternetAccess` on an offline device is deferred, not
  failed permanently).

**Precedence:** if a device has its own policy, it wins; otherwise fall back to
the policy on the device's `primary_group_id`.

Future optimization (not in scope): instead of relying solely on the poll
interval, the worker could compute the soonest upcoming transition across all
policies and wake exactly then for crisp edges. Polling is sufficient for now.

## Editor UI

A **Schedule editor**, replacing the ad-hoc "Recurring"/"Window" tab, reachable
from device detail, group detail, and the Schedules screen:

- Enable toggle.
- A list of rules: `[Block ▾] at [18:00] on [M T W T F · ·]`, with add/remove.
- **Quick-add helpers** so the common case is one click:
  - **Allow window**: blocked all day, allow `HH:MM–HH:MM` on selected days →
    generates `unblock@start` + `block@end`.
  - **Block window**: the inverse.
  These generate plain rules the user can then fine-tune.
- Live readout: "**Now: blocked** · next change: unblock today 4:00pm" and
  "All times in **Melbourne** (AEST/AEDT)."

## API

- `POST /api/schedules/policies` — create/replace a policy with its rules array.
- `GET /api/schedules/policies?targetType=&targetId=` — fetch a target's policy.
- `PATCH /api/schedules/policies/[id]` — enable/disable, edit rules.
- `DELETE /api/schedules/policies/[id]` — remove the policy.

Authorized via the existing `device.block` / `device.unblock` capabilities.
Manual block/unblock routes are unchanged externally; `blockService` gains the
override-stamping logic.

## Lifecycle edge cases

- **Policy created**: immediately reconcile → apply `policyState(now)`. Creating
  an allow-window at 10am (outside the window) blocks the device now.
- **Policy disabled / deleted**: leaves the device in its current state (no
  forced unblock); clears `override_until`. The device reverts to manual /
  reapply-only handling.
- **Device offline at transition time**: corrected on next poll after it
  returns online.
- **Manual action during an active override**: resets `override_until` to the
  new `nextTransition(now)`.
- **DST boundaries**: handled by `Intl`-based tz math; no special-casing.

## Legacy

The old cron-based `createWindow()` / `createRecurring()` are superseded by
policies, to avoid two engines driving the same device. The new editor writes
policies; the old recurring/window tabs are removed. One-shot **timers** and
**future-block** remain as-is (genuinely single events; cron jobs are correct
there). Assumption confirmed: no live recurring/window schedules exist to
migrate.

## Testing

- **Unit** — `policyState` / `nextTransition`: week wrap-around, empty days, DST
  boundary, multiple windows in one day, single-rule policy.
- **Unit** — override stamping in `blockService` (policy present vs absent).
- **Integration** (FakeRouterProvider + `.fake-router-state.json`):
  - manual override holds until the next transition, then the policy resumes;
  - offline-device catch-up;
  - device-over-group precedence;
  - policy creation applies current state immediately.

## Confirmed decisions

- Override model: **hold until next scheduled transition**.
- Scope: **full recurring schedule editor** (any days, multiple times/day),
  device and group.
- Timezone: **Australia/Melbourne**.
- One policy per target; **device-level overrides group-level**.
- No live recurring/window schedules to migrate — safe to replace the old
  engine.

## Deviations from spec

**Deviations from spec:** The pure schedule engine (`policyState`/`nextTransition`) is co-located in `runDeviceSync.ts` rather than a standalone `policyEngine.ts`, because the worker imports that file under native Node.js type-stripping which forbids external value imports. Functionally identical.
