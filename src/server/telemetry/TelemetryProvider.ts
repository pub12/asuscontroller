/**
 * src/server/telemetry/TelemetryProvider.ts — Server-only interface for
 * domain-level telemetry attribution.
 *
 * Provides per-device domain query events, sessionised active-time estimation,
 * and device presence signals — all at the DNS-query level (domain names only).
 *
 * Scope constraints (per spec):
 *   - Domain-level only: no DPI, no full URLs, no request payloads.
 *   - Per-device attribution via device IP → MAC resolution at the router.
 *   - Active-time is an ESTIMATE derived from DNS query cadence (not guaranteed).
 *   - Presence is derived from DNS activity, not a direct ping/ARP signal.
 *
 * Provider decision: undecided (NextDNS preferred, but API key not yet set up).
 * See docs/phase1-feasibility-report.md §4 and the open product decisions there.
 *
 * DO NOT import this file from any Client Component, shared lib, or
 * auto-executing path. Server-only.
 */
import 'server-only';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * A single domain query event attributed to a device.
 */
export interface DomainEvent {
  /** Device MAC address this query is attributed to (uppercase colon-separated). */
  deviceMac: string;
  /** The queried domain, e.g. "example.com". No full URLs. */
  domain: string;
  /** When the query was logged (ISO 8601 UTC). */
  timestamp: string;
  /** Whether the query was blocked by the DNS filter (if applicable). */
  blocked: boolean;
}

/**
 * Date string in "YYYY-MM-DD" format.
 */
export type DateString = string;

/**
 * Aggregated domain usage for a device on a specific day.
 * Populates app_domain_rollup_daily.
 */
export interface DomainRollup {
  deviceMac: string;
  domain: string;
  /** Date as "YYYY-MM-DD". */
  day: DateString;
  /** Total number of DNS queries recorded that day. */
  queryCount: number;
  /** ISO 8601 timestamp of the first query of the day. */
  firstSeen: string;
  /** ISO 8601 timestamp of the last query of the day. */
  lastSeen: string;
  /**
   * Estimated active minutes derived from query cadence heuristic.
   * Not guaranteed — a proxy metric only.
   */
  estActiveMinutes: number;
}

/**
 * Device presence signal for a given day.
 * Populates app_device_presence.
 */
export interface DevicePresence {
  deviceMac: string;
  /** Date as "YYYY-MM-DD". */
  day: DateString;
  /** Estimated minutes the device was active (DNS-query-derived heuristic). */
  connectedMinutes: number;
}

/**
 * Query options for fetching domain events.
 */
export interface DomainEventQuery {
  /** Filter to a specific device MAC (optional — returns all devices if omitted). */
  deviceMac?: string;
  /** Start of time range (ISO 8601 UTC). */
  from: string;
  /** End of time range (ISO 8601 UTC). */
  to: string;
  /** Maximum number of events to return (default provider-specific, max 1000). */
  limit?: number;
}

/**
 * Result from a provider when it is not yet configured.
 * Telemetry stubs return this instead of throwing.
 */
export interface NotConfiguredResult {
  configured: false;
  reason: string;
}

/**
 * Union of a successful result type T and the not-configured sentinel.
 * Callers must check `result.configured !== false` before using data.
 */
export type TelemetryResult<T> = ({ configured: true } & T) | NotConfiguredResult;

// ---------------------------------------------------------------------------
// TelemetryProvider interface
// ---------------------------------------------------------------------------

/**
 * TelemetryProvider — the server-side contract for fetching domain-level
 * telemetry data attributed to individual devices.
 *
 * All methods return TelemetryResult<T>, which is either the data (configured: true)
 * or a not-configured sentinel (configured: false). Callers MUST handle the
 * not-configured case without throwing.
 *
 * Providers are responsible for:
 *   1. Mapping device IPs to MACs (using the router's client list or a local cache).
 *   2. Returning domain names only — never full URLs or query parameters.
 *   3. Gracefully returning NotConfiguredResult when credentials/keys are absent.
 */
export interface TelemetryProvider {
  /**
   * Whether this provider is currently configured (API key set, endpoints reachable).
   * A `false` return does NOT throw — it signals graceful degradation.
   */
  isConfigured(): Promise<boolean>;

  /**
   * Fetch raw domain query events for the given time range.
   *
   * Used to ingest fresh events into app_domain_events during a telemetry sync job.
   *
   * @param query Time range and optional device filter.
   * @returns     Array of domain events or a not-configured sentinel.
   */
  getDomainEvents(
    query: DomainEventQuery
  ): Promise<TelemetryResult<{ events: DomainEvent[] }>>;

  /**
   * Fetch pre-aggregated daily domain rollup data from the provider.
   *
   * Some providers (e.g. NextDNS) expose aggregated stats directly.
   * If the provider does not, implementors should aggregate from raw events
   * or return a not-configured sentinel.
   *
   * @param deviceMac  Optional MAC filter.
   * @param day        The day to fetch ("YYYY-MM-DD").
   */
  getDailyRollup(
    deviceMac: string | undefined,
    day: DateString
  ): Promise<TelemetryResult<{ rollups: DomainRollup[] }>>;

  /**
   * Fetch device presence estimates for a given day.
   *
   * Derived from DNS query cadence — indicates the device was active during
   * the period, not that it was continuously connected.
   *
   * @param deviceMac  Optional MAC filter.
   * @param day        The day to fetch ("YYYY-MM-DD").
   */
  getDevicePresence(
    deviceMac: string | undefined,
    day: DateString
  ): Promise<TelemetryResult<{ presence: DevicePresence[] }>>;
}
