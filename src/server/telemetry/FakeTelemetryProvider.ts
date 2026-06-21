/**
 * FakeTelemetryProvider — deterministic in-memory fake for dev and autotests.
 *
 * Design notes:
 *  - NO randomness in the base dataset; the seed is static so test assertions
 *    can depend on event counts and timestamps without setup/teardown.
 *  - DELIBERATELY does NOT import 'server-only'. The plain-Node sync worker
 *    (scripts/worker.mjs, a later phase) imports this file directly under
 *    `node --input-type=module`. That runtime strips TS types via native
 *    type-stripping but does NOT resolve `@/` path aliases or `.js`→`.ts`
 *    redirects. Keeping this file free of runtime imports makes it safe.
 *  - ZERO network calls are made. All state is in-process.
 *  - Default seed: exactly 39 events across 10 devices, starting at
 *    2026-06-21T00:00:00.000Z with 1-minute steps between successive events.
 *    Events for 'doubleclick.net' are flagged blocked:true (ad/tracker domain).
 *
 * Simulation hooks (addDomainEvent / seed / clear) are intentionally public
 * so autotests and dev UI can inject events without touching any real provider.
 */

import type {
  TelemetryProvider,
  DomainEvent,
  DomainEventQuery,
  TelemetryResult,
  DomainRollup,
  DevicePresence,
  DateString,
} from './TelemetryProvider';

// ---------------------------------------------------------------------------
// Default seed construction — no randomness, no Date.now(), fixed base instant
// ---------------------------------------------------------------------------

const SEED_MACS = [
  'AA:BB:CC:00:00:01', 'AA:BB:CC:00:00:02', 'AA:BB:CC:00:00:03', 'AA:BB:CC:00:00:04', 'AA:BB:CC:00:00:05',
  'AA:BB:CC:00:00:06', 'AA:BB:CC:00:00:07', 'AA:BB:CC:00:00:08', 'AA:BB:CC:00:00:09', 'AA:BB:CC:00:00:0A',
];

const SEED_DOMAINS = [
  'youtube.com', 'netflix.com', 'google.com', 'tiktok.com', 'roblox.com',
  'spotify.com', 'doubleclick.net', 'instagram.com', 'wikipedia.org', 'github.com',
];

const BLOCKED_DOMAINS = new Set(['doubleclick.net']); // ad/tracker domain → blocked:true

const SEED_BASE_MS = Date.parse('2026-06-21T00:00:00.000Z');
const SEED_STEP_MS = 60_000; // 1 minute between successive events

function buildDefaultSeed(): DomainEvent[] {
  const events: DomainEvent[] = [];
  let idx = 0;
  for (let d = 0; d < SEED_MACS.length; d++) {
    const count = 3 + (d % 3); // 3,4,5,3,4,5,3,4,5,3 → 39 events total
    for (let e = 0; e < count; e++) {
      const domain = SEED_DOMAINS[(d + e) % SEED_DOMAINS.length];
      events.push({
        deviceMac: SEED_MACS[d],
        domain,
        timestamp: new Date(SEED_BASE_MS + idx * SEED_STEP_MS).toISOString(),
        blocked: BLOCKED_DOMAINS.has(domain),
      });
      idx++;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// FakeTelemetryProvider
// ---------------------------------------------------------------------------

export class FakeTelemetryProvider implements TelemetryProvider {
  /** Internal mutable event log. */
  private _events: DomainEvent[];

  /**
   * @param seed  Optional list of DomainEvent records to populate the fake
   *              with. Defaults to the built-in 39-event dataset. Pass a
   *              custom list in tests to control exactly which events exist.
   */
  constructor(seed?: DomainEvent[]) {
    const source = seed ?? buildDefaultSeed();
    // Shallow-copy each entry so mutations don't leak back to the caller's array.
    this._events = source.map((e) => ({ ...e }));
  }

  // -------------------------------------------------------------------------
  // TelemetryProvider — configuration check
  // -------------------------------------------------------------------------

  /** Always returns true — the fake is always "configured". */
  async isConfigured(): Promise<boolean> {
    return true;
  }

  // -------------------------------------------------------------------------
  // TelemetryProvider — read
  // -------------------------------------------------------------------------

  /**
   * Return domain events within a half-open [from, to) time window.
   *
   * ISO 8601 UTC strings produced by toISOString() sort lexicographically,
   * so string comparison is correct and deterministic here.
   *
   * @param query  Time range, optional MAC filter, and optional limit.
   */
  async getDomainEvents(
    query: DomainEventQuery
  ): Promise<TelemetryResult<{ events: DomainEvent[] }>> {
    const macFilter = query.deviceMac?.toUpperCase();

    let filtered = this._events.filter((e) => {
      if (e.timestamp < query.from || e.timestamp >= query.to) return false;
      if (macFilter && e.deviceMac.toUpperCase() !== macFilter) return false;
      return true;
    });

    // Sort ascending by timestamp.
    filtered = filtered.slice().sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

    // Apply limit if provided and positive.
    if (query.limit != null && query.limit > 0) {
      filtered = filtered.slice(0, query.limit);
    }

    // Shallow-copy each result so callers cannot mutate internal state.
    const events = filtered.map((e) => ({ ...e }));

    return { configured: true, events };
  }

  /**
   * Daily domain rollup — out of scope for this phase.
   * Returns an empty rollups array as a placeholder.
   */
  async getDailyRollup(
    _deviceMac: string | undefined,
    _day: DateString
  ): Promise<TelemetryResult<{ rollups: DomainRollup[] }>> {
    return { configured: true, rollups: [] };
  }

  /**
   * Device presence estimates — out of scope for this phase.
   * Returns an empty presence array as a placeholder.
   */
  async getDevicePresence(
    _deviceMac: string | undefined,
    _day: DateString
  ): Promise<TelemetryResult<{ presence: DevicePresence[] }>> {
    return { configured: true, presence: [] };
  }

  // -------------------------------------------------------------------------
  // Simulation hooks — for autotests and dev tooling
  // -------------------------------------------------------------------------

  /**
   * Append a single domain event to the in-memory log.
   * A shallow copy is stored so the caller's object cannot be mutated externally.
   *
   * @param event  The event to inject, e.g. an unknown-MAC event in a test.
   */
  addDomainEvent(event: DomainEvent): void {
    this._events.push({ ...event });
  }

  /**
   * Replace the entire in-memory dataset with the given events.
   * Shallow-copies each entry so the caller's array does not leak.
   *
   * @param events  Replacement event list.
   */
  seed(events: DomainEvent[]): void {
    this._events = events.map((e) => ({ ...e }));
  }

  /**
   * Empty the in-memory event log entirely.
   * After calling this, getDomainEvents() will return an empty array for any query.
   */
  clear(): void {
    this._events = [];
  }
}
