/**
 * src/server/sync/runDeviceSync.ts
 *
 * Pure device-sync core. Reconciles a router client list against the
 * app_devices and app_device_presence tables via the provided adapter.
 *
 * IMPORTANT CONSTRAINTS (enforced by design):
 *  - NO `import 'server-only'` — a later plain-Node sync worker imports this
 *    file directly under `node --input-type=module`. That runtime strips TS
 *    types but does NOT resolve `@/` aliases or `.js`→`.ts` redirects.
 *  - NO runtime value imports. All Node globals used (e.g. crypto.randomUUID)
 *    are available natively in Node 20+.
 *  - Adapter contract declared inline; RouterProvider/RouterClient imported
 *    as types only (erased at runtime).
 *  - Makes ZERO network calls — all I/O goes through the passed-in adapter
 *    and provider.
 *  - Safe to re-run (idempotent within the same tick).
 *
 * Used by:
 *  - src/app/api/sync-test/route.ts  — self-contained lifecycle autotest
 *  - scripts/worker.mjs              — plain-Node background sync worker (later phase)
 */

import type { RouterProvider } from '../router/RouterProvider';

// Adapter contract — declared inline so this file has zero runtime imports.
type SyncAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<any[]>;
};

// ---------------------------------------------------------------------------
// Pure schedule engine (co-located here, NOT in a separate module, because this
// file is imported by the plain-Node worker under native type-stripping which
// forbids external value imports / .ts extensions — see file header).
//
// Weekday convention: 0=Mon .. 6=Sun. time_min: 0..1439 local minutes.
// DST-correct: each candidate transition is materialized as a concrete UTC
// instant from its local wall time using the tz offset AT THAT DATE.
// ---------------------------------------------------------------------------

export interface PolicyRule {
  weekday: number;            // 0=Mon .. 6=Sun
  time_min: number;           // 0..1439
  action: 'block' | 'unblock';
}

const POLICY_TZ = 'Australia/Melbourne';

// Local-time parts of an instant in a given tz.
function tzParts(ms: number, tz: string): { y: number; mo: number; d: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wkMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    y: parseInt(p.year, 10), mo: parseInt(p.month, 10), d: parseInt(p.day, 10),
    weekday: wkMap[p.weekday as string],
  };
}

// UTC offset (ms) for an instant in tz (positive = ahead of UTC).
function tzOffsetMs(ms: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    parseInt(p.year, 10), parseInt(p.month, 10) - 1, parseInt(p.day, 10),
    parseInt(p.hour, 10), parseInt(p.minute, 10), parseInt(p.second, 10),
  );
  return asUtc - ms;
}

// Concrete UTC instant (ms) for a given local wall time on a specific calendar date.
function wallToUtcMs(y: number, mo: number, d: number, minutes: number, tz: string): number {
  const naiveUtc = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return naiveUtc - tzOffsetMs(naiveUtc, tz);
}

// Materialize sorted {ms, action} transition instants across [fromMs, fromMs + days*86400000].
function materialize(rules: PolicyRule[], fromMs: number, days: number, tz: string): { ms: number; action: 'block' | 'unblock' }[] {
  const out: { ms: number; action: 'block' | 'unblock' }[] = [];
  for (let i = 0; i <= days; i++) {
    const dayMs = fromMs + i * 86_400_000;
    const { y, mo, d, weekday } = tzParts(dayMs, tz);
    for (const r of rules) {
      if (r.weekday !== weekday) continue;
      out.push({ ms: wallToUtcMs(y, mo, d, r.time_min, tz), action: r.action });
    }
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

export function policyState(rules: PolicyRule[], nowMs: number, tz: string = POLICY_TZ, defaultAction: 'block' | 'unblock' = 'unblock'): 'block' | 'unblock' {
  if (rules.length === 0) return defaultAction;
  // Look back up to 8 days for the most recent transition at-or-before now.
  const pts = materialize(rules, nowMs - 8 * 86_400_000, 9, tz);
  let last: 'block' | 'unblock' = defaultAction;
  for (const p of pts) { if (p.ms <= nowMs) last = p.action; else break; }
  return last;
}

export function nextTransition(rules: PolicyRule[], nowMs: number, tz: string = POLICY_TZ): number | null {
  if (rules.length === 0) return null;
  const pts = materialize(rules, nowMs - 86_400_000, 9, tz);
  for (const p of pts) { if (p.ms > nowMs) return p.ms; }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyncSummary {
  seen: number;
  inserted: number;
  updated: number;
  went_offline: number;
  presence_minutes_added: number;
  reapplied: number;
  /** Block records updated to match live router truth (pull reconcile only). */
  block_pulled: number;
}

/**
 * Reconcile the router's current client list with the DB.
 *
 * @param adapter     hazo_connect adapter exposing rawQuery.
 * @param provider    RouterProvider implementation (real or fake).
 * @param nowIso      Current timestamp as an ISO-8601 string (UTC).
 * @param options.intervalSec  Nominal poll interval in seconds (default 60).
 *                    Used to cap presence accrual to one interval max.
 * @param options.blockReconcile  How to reconcile block state against the router:
 *                    'reapply' (default) — the app's is_blocked is the desired
 *                    state; if the router has drifted (reboot lost the rule),
 *                    re-apply it. This is what the background worker uses.
 *                    'pull' — the ROUTER is ground truth; mirror its live block
 *                    state into app_block_state. This is what the manual
 *                    "Refresh" button uses, so an unblock done directly on the
 *                    router clears the badge here instead of being re-applied.
 */
export async function runDeviceSync(
  adapter: SyncAdapter,
  provider: RouterProvider,
  nowIso: string,
  options?: { intervalSec?: number; blockReconcile?: 'reapply' | 'pull' },
): Promise<SyncSummary> {
  const intervalSec = options?.intervalSec ?? 60;
  const blockReconcile = options?.blockReconcile ?? 'reapply';
  const day = nowIso.slice(0, 10); // YYYY-MM-DD (UTC)

  const summary: SyncSummary = {
    seen: 0,
    inserted: 0,
    updated: 0,
    went_offline: 0,
    presence_minutes_added: 0,
    reapplied: 0,
    block_pulled: 0,
  };

  // 1. Fetch currently connected clients from the router.
  const clients = await provider.getClientList();
  summary.seen = clients.length;

  const seen = new Set(clients.map((c) => c.mac));

  // 2. Upsert every client the router knows about (connected + offline) into
  //    app_devices, persisting each one's live online/offline status.
  for (const client of clients) {
    const status = client.connected ? 'online' : 'offline';
    // Look up existing row by MAC.
    const rows = await adapter.rawQuery(
      'SELECT id, status, last_seen FROM app_devices WHERE mac = ?',
      { params: [client.mac] },
    );

    if (rows.length > 0) {
      // --- Existing device ---
      const row = rows[0] as { id: string; status: string; last_seen: string };

      // Presence accrual: only when the device was online before AND is online
      // now — an offline poll closes the window, it doesn't extend it.
      if (client.connected && row.status === 'online') {
        const deltaSec = (Date.parse(nowIso) - Date.parse(row.last_seen)) / 1000;
        const minutes = Math.round(Math.min(intervalSec, Math.max(0, deltaSec)) / 60);
        if (minutes > 0) {
          await adapter.rawQuery(
            `INSERT INTO app_device_presence (device_id, day, connected_minutes)
             VALUES (?, ?, ?)
             ON CONFLICT(device_id, day)
             DO UPDATE SET connected_minutes = connected_minutes + excluded.connected_minutes`,
            { params: [row.id, day, minutes] },
          );
          summary.presence_minutes_added += minutes;
        }
      }

      // Update router-owned fields + last_seen. Never touch friendly_name,
      // icon, notes, primary_group_id, first_seen, or is_new.
      await adapter.rawQuery(
        `UPDATE app_devices
         SET hostname = ?, vendor = ?, current_ip = ?, last_band = ?,
             status = ?, last_seen = ?
         WHERE id = ?`,
        { params: [client.name, client.vendor, client.ip, client.band, status, nowIso, row.id] },
      );
      summary.updated++;
    } else {
      // --- New device ---
      const id = 'dev_' + crypto.randomUUID();
      await adapter.rawQuery(
        `INSERT INTO app_devices
           (id, mac, hostname, vendor, current_ip, last_band, status, is_new, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        { params: [id, client.mac, client.name, client.vendor, client.ip, client.band, status, nowIso, nowIso] },
      );
      summary.inserted++;
      // No presence accrual on initial insert — we have no prior window.
    }
  }

  // 2.5 Block-state reconcile. Best-effort: a failure here must never break the
  // core presence sync. Direction depends on options.blockReconcile.
  //
  // 'reapply' (worker default): the app is ground truth. If the router has lost
  // a block (reboot, manual change), re-apply it.
  if (blockReconcile === 'reapply') try {
    const nowMs = Date.parse(nowIso);

    // Build effective-policy map: deviceId -> { rules, tz }. Device-level policy
    // wins; otherwise the device's primary_group_id group policy applies.
    const policyRows = (await adapter.rawQuery(
      `SELECT id, target_type, target_id, tz, default_action FROM app_schedule_policies WHERE enabled = 1`,
    )) as { id: string; target_type: string; target_id: string; tz: string; default_action: string }[];
    const ruleRows = (await adapter.rawQuery(
      `SELECT policy_id, weekday, time_min, action FROM app_schedule_rules`,
    )) as { policy_id: string; weekday: number; time_min: number; action: 'block' | 'unblock' }[];
    const rulesByPolicy = new Map<string, PolicyRule[]>();
    for (const r of ruleRows) {
      const arr = rulesByPolicy.get(r.policy_id) ?? [];
      arr.push({ weekday: Number(r.weekday), time_min: Number(r.time_min), action: r.action });
      rulesByPolicy.set(r.policy_id, arr);
    }
    const devicePolicy = new Map<string, { rules: PolicyRule[]; tz: string; defaultAction: 'block' | 'unblock' }>();
    const groupPolicy = new Map<string, { rules: PolicyRule[]; tz: string; defaultAction: 'block' | 'unblock' }>();
    for (const p of policyRows) {
      const entry = { rules: rulesByPolicy.get(p.id) ?? [], tz: p.tz || 'Australia/Melbourne', defaultAction: (p.default_action === 'block' ? 'block' : 'unblock') as 'block' | 'unblock' };
      if (p.target_type === 'device') devicePolicy.set(p.target_id, entry);
      else groupPolicy.set(p.target_id, entry);
    }
    // Resolve effective policy per device that has any state row OR is targeted.
    const allDevices = (await adapter.rawQuery(
      `SELECT d.id AS id, d.mac AS mac, d.status AS status, d.primary_group_id AS gid,
              COALESCE(b.is_blocked,0) AS is_blocked, b.router_synced AS router_synced, b.override_until AS override_until
         FROM app_devices d LEFT JOIN app_block_state b ON b.device_id = d.id`,
    )) as { id: string; mac: string; status: string; gid: string | null; is_blocked: number; router_synced: number | null; override_until: string | null }[];

    const policyDeviceIds = new Set<string>();

    for (const d of allDevices) {
      const eff = devicePolicy.get(d.id) ?? (d.gid ? groupPolicy.get(d.gid) : undefined);
      if (!eff) continue;
      policyDeviceIds.add(d.id);
      if (d.status !== 'online') continue; // offline: corrected when it returns

      // Honor an active manual-override hold. When the policy has no upcoming
      // transition (nextTransition is null — i.e. no rules), there's no natural
      // expiry, so keep the override alive by pushing it to a far-future sentinel.
      if (d.override_until && nowMs < Date.parse(d.override_until)) {
        if (nextTransition(eff.rules, nowMs, eff.tz) === null) {
          const farFuture = new Date(nowMs + 365 * 24 * 60 * 60 * 1000).toISOString();
          await adapter.rawQuery(`UPDATE app_block_state SET override_until = ? WHERE device_id = ?`, { params: [farFuture, d.id] });
        }
        continue;
      }

      const desired = policyState(eff.rules, nowMs, eff.tz, eff.defaultAction);
      const wantBlocked = desired === 'block';
      const isBlocked = Number(d.is_blocked) === 1;
      const overrideExpired = d.override_until != null && nowMs >= Date.parse(d.override_until);

      if (wantBlocked !== isBlocked) {
        const res = await provider.setInternetAccess(d.mac, !wantBlocked); // enabled=true means unblock
        const nowIso2 = nowIso;
        await adapter.rawQuery(
          `INSERT INTO app_block_state (device_id, is_blocked, blocked_by, blocked_at, router_synced, override_until)
           VALUES (?, ?, 'schedule', ?, ?, NULL)
           ON CONFLICT(device_id) DO UPDATE SET
             is_blocked = excluded.is_blocked, blocked_by = 'schedule',
             blocked_at = excluded.blocked_at, router_synced = excluded.router_synced, override_until = NULL`,
          { params: [d.id, wantBlocked ? 1 : 0, nowIso2, res.success ? 1 : 0] },
        );
        try {
          await adapter.rawQuery(
            `INSERT INTO hazo_audit_intent (id, correlation_id, event_name, payload, subject_kind, subject_id, actor_kind, occurred_at)
             VALUES (?, ?, 'device_block_scheduled', ?, 'device', ?, 'background_job', ?)`,
            { params: [crypto.randomUUID(), crypto.randomUUID(), JSON.stringify({ mac: d.mac, desired, router_synced: res.success }), d.id, nowIso] },
          );
        } catch { /* audit best-effort */ }
        summary.reapplied++;
      } else if (overrideExpired) {
        // State already matches policy; just clear the stale hold.
        await adapter.rawQuery(`UPDATE app_block_state SET override_until = NULL WHERE device_id = ?`, { params: [d.id] });
      }
    }

    // Legacy re-block-only pass for devices WITHOUT an effective policy.
    const blockedRows = (await adapter.rawQuery(
      `SELECT b.device_id AS device_id, d.mac AS mac, b.router_synced AS router_synced
         FROM app_block_state b JOIN app_devices d ON d.id = b.device_id
        WHERE b.is_blocked = 1`,
    )) as { device_id: string; mac: string; router_synced: number }[];

    for (const b of blockedRows) {
      if (policyDeviceIds.has(b.device_id)) continue; // handled by policy reconcile above
      let routerState: boolean | null = null;
      if (typeof provider.getBlockState === 'function') routerState = await provider.getBlockState(b.mac);
      if (routerState !== true) {
        const res = await provider.setInternetAccess(b.mac, false);
        await adapter.rawQuery(`UPDATE app_block_state SET router_synced = ? WHERE device_id = ?`, { params: [res.success ? 1 : 0, b.device_id] });
        try {
          await adapter.rawQuery(
            `INSERT INTO hazo_audit_intent (id, correlation_id, event_name, payload, subject_kind, subject_id, actor_kind, occurred_at)
             VALUES (?, ?, 'device_block_reapplied', ?, 'device', ?, 'background_job', ?)`,
            { params: [crypto.randomUUID(), crypto.randomUUID(), JSON.stringify({ mac: b.mac, router_state: routerState, router_synced: res.success }), b.device_id, nowIso] },
          );
        } catch { /* audit best-effort */ }
        summary.reapplied++;
      } else if (b.router_synced !== 1) {
        await adapter.rawQuery(`UPDATE app_block_state SET router_synced = 1 WHERE device_id = ?`, { params: [b.device_id] });
      }
    }
  } catch (err) {
    console.warn('[runDeviceSync] reapply reconcile failed (non-fatal):', err);
  }

  // 'pull' (manual Refresh): the ROUTER is ground truth. Read the live block set
  // once and mirror it into app_block_state, so a block/unblock done directly on
  // the router is reflected here (e.g. a stale "Blocked" badge clears) instead of
  // being re-applied. Only acts when the provider can enumerate block state.
  if (blockReconcile === 'pull' && typeof provider.getBlockedMacs === 'function') try {
    const blockedMacs = await provider.getBlockedMacs();
    const blockedSet = new Set(blockedMacs.map((m) => m.toUpperCase()));

    // Every device we have a row for, plus any the router now reports blocked.
    const devRows = (await adapter.rawQuery(
      `SELECT d.id AS id, d.mac AS mac,
              COALESCE(b.is_blocked, 0) AS is_blocked
         FROM app_devices d
         LEFT JOIN app_block_state b ON b.device_id = d.id`,
    )) as { id: string; mac: string; is_blocked: number }[];

    for (const d of devRows) {
      const routerBlocked = blockedSet.has((d.mac ?? '').toUpperCase());
      const appBlocked = Number(d.is_blocked) === 1;
      if (routerBlocked === appBlocked) continue; // already matches truth

      // Mirror router truth into app_block_state (upsert; router_synced = 1
      // because we just read it straight from the router).
      await adapter.rawQuery(
        `INSERT INTO app_block_state (device_id, is_blocked, router_synced)
         VALUES (?, ?, 1)
         ON CONFLICT(device_id)
         DO UPDATE SET is_blocked = excluded.is_blocked, router_synced = 1`,
        { params: [d.id, routerBlocked ? 1 : 0] },
      );
      try {
        await adapter.rawQuery(
          `INSERT INTO hazo_audit_intent
             (id, correlation_id, event_name, payload, subject_kind, subject_id, actor_kind, occurred_at)
           VALUES (?, ?, 'device_block_pulled', ?, 'device', ?, 'background_job', ?)`,
          { params: [crypto.randomUUID(), crypto.randomUUID(),
              JSON.stringify({ mac: d.mac, router_blocked: routerBlocked }),
              d.id, nowIso] },
        );
      } catch { /* audit is best-effort */ }
      summary.block_pulled++;
    }
  } catch (err) {
    console.warn('[runDeviceSync] pull reconcile failed (non-fatal):', err);
  }

  // 3. Offline pass: mark DB-online devices that are absent from this poll.
  const onlineRows = await adapter.rawQuery(
    `SELECT id, mac FROM app_devices WHERE status = 'online'`,
  ) as { id: string; mac: string }[];

  for (const row of onlineRows) {
    if (!seen.has(row.mac)) {
      await adapter.rawQuery(
        `UPDATE app_devices SET status = 'offline' WHERE id = ?`,
        { params: [row.id] },
      );
      summary.went_offline++;
    }
  }

  return summary;
}
