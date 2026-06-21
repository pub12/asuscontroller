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
// Public API
// ---------------------------------------------------------------------------

export interface SyncSummary {
  seen: number;
  inserted: number;
  updated: number;
  went_offline: number;
  presence_minutes_added: number;
  reapplied: number;
}

/**
 * Reconcile the router's current client list with the DB.
 *
 * @param adapter     hazo_connect adapter exposing rawQuery.
 * @param provider    RouterProvider implementation (real or fake).
 * @param nowIso      Current timestamp as an ISO-8601 string (UTC).
 * @param options.intervalSec  Nominal poll interval in seconds (default 60).
 *                    Used to cap presence accrual to one interval max.
 */
export async function runDeviceSync(
  adapter: SyncAdapter,
  provider: RouterProvider,
  nowIso: string,
  options?: { intervalSec?: number },
): Promise<SyncSummary> {
  const intervalSec = options?.intervalSec ?? 60;
  const day = nowIso.slice(0, 10); // YYYY-MM-DD (UTC)

  const summary: SyncSummary = {
    seen: 0,
    inserted: 0,
    updated: 0,
    went_offline: 0,
    presence_minutes_added: 0,
    reapplied: 0,
  };

  // 1. Fetch currently connected clients from the router.
  const clients = await provider.getClientList();
  summary.seen = clients.length;

  const seen = new Set(clients.map((c) => c.mac));

  // 2. Upsert each connected client into app_devices.
  for (const client of clients) {
    // Look up existing row by MAC.
    const rows = await adapter.rawQuery(
      'SELECT id, status, last_seen FROM app_devices WHERE mac = ?',
      { params: [client.mac] },
    );

    if (rows.length > 0) {
      // --- Existing device ---
      const row = rows[0] as { id: string; status: string; last_seen: string };

      // Presence accrual: only when prior status was 'online'.
      if (row.status === 'online') {
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
             status = 'online', last_seen = ?
         WHERE id = ?`,
        { params: [client.name, client.vendor, client.ip, client.band, nowIso, row.id] },
      );
      summary.updated++;
    } else {
      // --- New device ---
      const id = 'dev_' + crypto.randomUUID();
      await adapter.rawQuery(
        `INSERT INTO app_devices
           (id, mac, hostname, vendor, current_ip, last_band, status, is_new, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, 'online', 1, ?, ?)`,
        { params: [id, client.mac, client.name, client.vendor, client.ip, client.band, nowIso, nowIso] },
      );
      summary.inserted++;
      // No presence accrual on initial insert — we have no prior window.
    }
  }

  // 2.5 Drift reconcile: re-assert desired block state on the router.
  // Desired state = app_block_state.is_blocked. If the router has lost a block
  // (reports not-blocked or unknown), re-apply it. Pure SQL + provider calls so
  // this file stays import-free for the plain-Node worker. Best-effort: a
  // reconcile failure must never break presence sync.
  try {
    const blockedRows = (await adapter.rawQuery(
      `SELECT b.device_id AS device_id, d.mac AS mac, b.router_synced AS router_synced
         FROM app_block_state b
         JOIN app_devices d ON d.id = b.device_id
        WHERE b.is_blocked = 1`,
    )) as { device_id: string; mac: string; router_synced: number }[];

    for (const b of blockedRows) {
      let routerState: boolean | null = null;
      if (typeof provider.getBlockState === 'function') {
        routerState = await provider.getBlockState(b.mac);
      }
      if (routerState !== true) {
        // Drift (router not-blocked or unknown) — re-apply the block.
        const res = await provider.setInternetAccess(b.mac, false);
        await adapter.rawQuery(
          `UPDATE app_block_state SET router_synced = ? WHERE device_id = ?`,
          { params: [res.success ? 1 : 0, b.device_id] },
        );
        try {
          await adapter.rawQuery(
            `INSERT INTO hazo_audit_intent
               (id, correlation_id, event_name, payload, subject_kind, subject_id, actor_kind, occurred_at)
             VALUES (?, ?, 'device_block_reapplied', ?, 'device', ?, 'background_job', ?)`,
            { params: [crypto.randomUUID(), crypto.randomUUID(),
                JSON.stringify({ mac: b.mac, router_state: routerState, router_synced: res.success }),
                b.device_id, nowIso] },
          );
        } catch { /* audit is best-effort; the re-block already applied */ }
        summary.reapplied++;
      } else if (b.router_synced !== 1) {
        // Router already enforces the block; just mark us converged.
        await adapter.rawQuery(
          `UPDATE app_block_state SET router_synced = 1 WHERE device_id = ?`,
          { params: [b.device_id] },
        );
      }
    }
  } catch (err) {
    // Never let reconcile break the core presence sync.
    console.warn('[runDeviceSync] reconcile pass failed (non-fatal):', err);
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
