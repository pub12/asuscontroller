/**
 * FakeRouterProvider — deterministic in-memory fake for dev and autotests.
 *
 * Design notes:
 *  - NO randomness in the base dataset; the seed is static so test assertions
 *    can depend on device counts and MAC addresses without setup/teardown.
 *  - DELIBERATELY does NOT import 'server-only'. The plain-Node sync worker
 *    (scripts/worker.mjs, a later phase) imports this file directly under
 *    `node --input-type=module`. That runtime strips TS types via native
 *    type-stripping but does NOT resolve `@/` path aliases or `.js`→`.ts`
 *    redirects. Keeping this file free of runtime imports makes it safe.
 *  - ZERO network calls are made. All state is in-process.
 *
 * Simulation hooks (goOffline / goOnline / addDevice / removeDevice) are
 * intentionally public so autotests and dev UI can drive connectivity changes
 * without touching any real router.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { RouterProvider, RouterClient, AccessResult, CapabilityMap } from './RouterProvider';

/**
 * Shared on-disk path for the fake router's block state.
 *
 * The web app (Next.js) and the background worker run as SEPARATE processes,
 * each with its own FakeRouterProvider instance. Without a shared store, a
 * block/unblock done in one process is invisible to the other's reconcile —
 * so a scheduled unblock fired by the worker gets resurrected by the web app's
 * pull-reconcile (and vice-versa). Pointing both production-path instances at
 * the same file makes the fake behave like a single shared router, which is the
 * whole point of a faithful fake. Honors NETWARDEN_FAKE_ROUTER_STATE if set.
 *
 * Autotests deliberately do NOT pass a persistPath, so they stay fully
 * hermetic (pure in-memory, no cross-test or cross-process bleed).
 */
export function fakeRouterStatePath(): string {
  return process.env.NETWARDEN_FAKE_ROUTER_STATE || join(process.cwd(), '.fake-router-state.json');
}

// ---------------------------------------------------------------------------
// Default seed — 10 plausible devices; no randomness
// ---------------------------------------------------------------------------

const DEFAULT_SEED: RouterClient[] = [
  { mac: 'AA:BB:CC:00:00:01', ip: '192.168.50.101', name: 'Living-Room-TV',  connected: true, band: 'wired', vendor: 'Samsung Electronics' },
  { mac: 'AA:BB:CC:00:00:02', ip: '192.168.50.102', name: 'MacBook-Air',     connected: true, band: '5G',    vendor: 'Apple, Inc.' },
  { mac: 'AA:BB:CC:00:00:03', ip: '192.168.50.103', name: 'iPhone-15',       connected: true, band: '6G',    vendor: 'Apple, Inc.' },
  { mac: 'AA:BB:CC:00:00:04', ip: '192.168.50.104', name: 'Pixel-8',         connected: true, band: '5G',    vendor: 'Google' },
  { mac: 'AA:BB:CC:00:00:05', ip: '192.168.50.105', name: 'Galaxy-Tab-S9',   connected: true, band: '2G',    vendor: 'Samsung Electronics' },
  { mac: 'AA:BB:CC:00:00:06', ip: '192.168.50.106', name: 'Echo-Dot',        connected: true, band: '2G',    vendor: 'Amazon Technologies' },
  { mac: 'AA:BB:CC:00:00:07', ip: '192.168.50.107', name: 'Nest-Hub',        connected: true, band: '2G',    vendor: 'Google' },
  { mac: 'AA:BB:CC:00:00:08', ip: '192.168.50.108', name: 'Nintendo-Switch', connected: true, band: '5G',    vendor: 'Nintendo' },
  { mac: 'AA:BB:CC:00:00:09', ip: '192.168.50.109', name: 'Desktop-PC',      connected: true, band: 'wired', vendor: 'ASUSTeK Computer' },
  { mac: 'AA:BB:CC:00:00:0A', ip: '192.168.50.110', name: 'iPad-Pro',        connected: true, band: '6G',    vendor: 'Apple, Inc.' },
];

// ---------------------------------------------------------------------------
// Internal device record — extends RouterClient with a mutable connected flag
// ---------------------------------------------------------------------------

interface DeviceRecord extends RouterClient {
  connected: boolean;
}

// ---------------------------------------------------------------------------
// FakeRouterProvider
// ---------------------------------------------------------------------------

export class FakeRouterProvider implements RouterProvider {
  /** Internal mutable device map keyed by MAC address. */
  private readonly _devices: Map<string, DeviceRecord> = new Map();

  /** Internal block state keyed by MAC address. true = blocked (internet OFF). */
  private readonly _blocked: Map<string, boolean> = new Map();

  /**
   * When set, block state is mirrored to/from this file so separate processes
   * (web + worker) share one source of router truth. Unset = pure in-memory.
   */
  private readonly _persistPath?: string;

  /**
   * @param seed  Optional list of RouterClient records to populate the fake
   *              with. Defaults to the built-in 10-device dataset. Pass a
   *              custom list in tests to control exactly which devices exist.
   * @param opts.persistPath  Optional file path for cross-process block-state
   *              sharing. Omit in autotests to keep them hermetic.
   */
  constructor(seed?: RouterClient[], opts?: { persistPath?: string }) {
    const source = seed ?? DEFAULT_SEED;
    for (const client of source) {
      // Shallow-copy each entry so mutations don't leak back to the caller's array.
      this._devices.set(client.mac, { ...client });
    }
    this._persistPath = opts?.persistPath;
    // Hydrate from the shared file so this instance starts in sync with peers.
    this._loadBlocked();
  }

  // -------------------------------------------------------------------------
  // Cross-process block-state persistence (no-op unless _persistPath is set)
  // -------------------------------------------------------------------------

  /** Load the block map from the shared file, replacing in-memory state. */
  private _loadBlocked(): void {
    if (!this._persistPath || !existsSync(this._persistPath)) return;
    try {
      const raw = readFileSync(this._persistPath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, boolean>;
      this._blocked.clear();
      for (const [mac, blocked] of Object.entries(obj)) {
        this._blocked.set(mac, !!blocked);
      }
    } catch {
      // Corrupt/partial file — ignore and keep current in-memory state.
    }
  }

  /** Persist the block map to the shared file (atomic write via temp + rename). */
  private _saveBlocked(): void {
    if (!this._persistPath) return;
    try {
      const obj: Record<string, boolean> = {};
      for (const [mac, blocked] of this._blocked.entries()) obj[mac] = blocked;
      const tmp = `${this._persistPath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(obj), 'utf8');
      renameSync(tmp, this._persistPath);
    } catch {
      // Best-effort — a failed persist must never break a block/unblock call.
    }
  }

  // -------------------------------------------------------------------------
  // RouterProvider — auth lifecycle
  // -------------------------------------------------------------------------

  /** No-op: the fake needs no authentication. Always resolves immediately. */
  async login(): Promise<void> {
    // Nothing to do.
  }

  /** Always returns true — the fake is always "authenticated". */
  isAuthenticated(): boolean {
    return true;
  }

  // -------------------------------------------------------------------------
  // RouterProvider — read
  // -------------------------------------------------------------------------

  /**
   * Return a fresh array of shallow-copied RouterClient records for every
   * device whose connected flag is currently true.
   */
  async getClientList(): Promise<RouterClient[]> {
    const result: RouterClient[] = [];
    for (const record of this._devices.values()) {
      if (record.connected) {
        result.push({ ...record });
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // RouterProvider — write (internet access)
  // -------------------------------------------------------------------------

  /**
   * Simulate enabling or disabling internet access for a client by MAC address.
   * Tracks block state in-memory; no network calls are made.
   *
   * @param mac     Uppercase colon-separated MAC, e.g. "AA:BB:CC:DD:EE:FF".
   * @param enabled true = grant internet access (unblock), false = block internet access.
   */
  async setInternetAccess(mac: string, enabled: boolean): Promise<AccessResult> {
    // Load-modify-save so a concurrent peer's other-MAC changes aren't clobbered.
    this._loadBlocked();
    this._blocked.set(mac, !enabled);
    this._saveBlocked();
    return {
      success: true,
      message: `Internet access ${enabled ? 'ENABLED' : 'DISABLED'} for ${mac} (fake)`,
    };
  }

  /**
   * Read the current per-MAC internet-block state from in-memory state.
   * The fake authoritatively knows its own state, so it never returns null.
   *
   * @returns true  = this MAC is blocked (internet OFF),
   *          false = this MAC is NOT blocked.
   */
  async getBlockState(mac: string): Promise<boolean | null> {
    this._loadBlocked(); // pick up writes from peer processes
    return this._blocked.get(mac) ?? false;
  }

  /** Bulk read of every MAC currently blocked in the fake's in-memory state. */
  async getBlockedMacs(): Promise<string[]> {
    this._loadBlocked(); // pick up writes from peer processes
    const blocked: string[] = [];
    for (const [mac, isBlocked] of this._blocked.entries()) {
      if (isBlocked) blocked.push(mac.toUpperCase());
    }
    return blocked;
  }

  // -------------------------------------------------------------------------
  // RouterProvider — capabilities
  // -------------------------------------------------------------------------

  capabilities(): CapabilityMap {
    return {
      getClientList: true,
      setInternetAccess: true,
      reboot: false,
    };
  }

  // -------------------------------------------------------------------------
  // RouterProvider — reboot (not supported)
  // -------------------------------------------------------------------------

  /** Throws — the fake does not support reboot. */
  async reboot(): Promise<void> {
    throw new Error('FakeRouterProvider does not support reboot.');
  }

  // -------------------------------------------------------------------------
  // Simulation hooks — for autotests and dev tooling
  // -------------------------------------------------------------------------

  /**
   * Mark a device as disconnected by MAC address.
   * It will no longer appear in getClientList() results.
   * Silently ignored if the MAC is unknown.
   *
   * @param mac  Uppercase colon-separated MAC, e.g. "AA:BB:CC:00:00:01".
   */
  goOffline(mac: string): void {
    const device = this._devices.get(mac);
    if (device) {
      device.connected = false;
    }
  }

  /**
   * Mark a device as connected by MAC address.
   * It will reappear in getClientList() results.
   * Silently ignored if the MAC is unknown.
   *
   * @param mac  Uppercase colon-separated MAC, e.g. "AA:BB:CC:00:00:01".
   */
  goOnline(mac: string): void {
    const device = this._devices.get(mac);
    if (device) {
      device.connected = true;
    }
  }

  /**
   * Add a brand-new device to the fake, marking it as connected.
   * It will appear on the next getClientList() call.
   * If a device with the same MAC already exists it is replaced entirely.
   *
   * @param client  Full RouterClient record for the new device.
   */
  addDevice(client: RouterClient): void {
    this._devices.set(client.mac, { ...client, connected: true });
  }

  /**
   * Remove a device from the fake entirely (not just offline — gone).
   * It will not appear in any future getClientList() results.
   * Silently ignored if the MAC is unknown.
   *
   * @param mac  Uppercase colon-separated MAC.
   */
  removeDevice(mac: string): void {
    this._devices.delete(mac);
  }

  /**
   * Force the router-level block state for a MAC directly, simulating an
   * out-of-band change (e.g. someone unblocked at the router). Used by drift-
   * reconcile tests to diverge router state from the app's intended state.
   */
  forceBlockState(mac: string, blocked: boolean): void {
    this._loadBlocked();
    this._blocked.set(mac, blocked);
    this._saveBlocked();
  }
}
