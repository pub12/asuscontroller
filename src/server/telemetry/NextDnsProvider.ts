/**
 * STUB — provider undecided (NextDNS preferred).
 * Returns not-configured until NEXTDNS_API_KEY is set.
 *
 * src/server/telemetry/NextDnsProvider.ts — Stub implementation of
 * TelemetryProvider targeting the NextDNS Logs API.
 *
 * NextDNS API reference (to be wired in a later phase):
 *   Base URL: https://api.nextdns.io
 *   Auth:     X-Api-Key: <key> header
 *   Logs:     GET /profiles/<profileId>/logs?from=<ISO>&to=<ISO>&raw=1
 *
 * Current state: NEXTDNS_API_KEY is not set in this project's environment.
 * All methods return a NotConfiguredResult sentinel — they NEVER throw.
 *
 * Wire this provider only after:
 *   1. NEXTDNS_API_KEY is set in the environment (via hazo_secure).
 *   2. The NextDNS profile ID is confirmed and stored.
 *   3. The product decision on telemetry provider is locked.
 *
 * See docs/phase1-feasibility-report.md §4 for open decisions.
 *
 * DO NOT import this file from any route, layout, autotest, or shared lib.
 */
import 'server-only';
import { getTelemetryKey } from '../secrets';
import type {
  TelemetryProvider,
  DomainEventQuery,
  DateString,
  TelemetryResult,
  DomainEvent,
  DomainRollup,
  DevicePresence,
  NotConfiguredResult,
} from './TelemetryProvider';

// ---------------------------------------------------------------------------
// Sentinel builder
// ---------------------------------------------------------------------------

function notConfigured(detail?: string): NotConfiguredResult {
  const base = 'NextDNS not set up — NEXTDNS_API_KEY is not configured in this environment.';
  return {
    configured: false,
    reason: detail ? `${base} ${detail}` : base,
  };
}

// ---------------------------------------------------------------------------
// NextDnsProvider (stub)
// ---------------------------------------------------------------------------

/**
 * Stub implementation of TelemetryProvider using the NextDNS Logs API.
 *
 * Until NEXTDNS_API_KEY is set, every method returns a not-configured sentinel.
 * No network calls are made when the key is absent.
 *
 * When the key IS set (future phase), methods will:
 *   - Call https://api.nextdns.io/profiles/<profileId>/logs
 *   - Map log entries to DomainEvent records by IP → MAC
 *   - Aggregate rollups from raw logs (NextDNS does not expose pre-aggregated daily stats)
 *   - Derive presence estimates from query cadence
 */
export class NextDnsProvider implements TelemetryProvider {
  /**
   * Whether this provider is currently configured.
   * Returns false until NEXTDNS_API_KEY is set in the environment.
   * Never throws.
   */
  async isConfigured(): Promise<boolean> {
    try {
      const key = await getTelemetryKey();
      return key !== null;
    } catch {
      return false;
    }
  }

  /**
   * Fetch raw domain query events for the given time range.
   *
   * STUB: returns not-configured until NEXTDNS_API_KEY is set.
   *
   * Future implementation:
   *   GET https://api.nextdns.io/profiles/<profileId>/logs
   *     ?from=<from>&to=<to>&raw=1
   *   Headers: X-Api-Key: <key>
   *   Map each log entry's clientIp → deviceMac via router client list.
   */
  async getDomainEvents(
    _query: DomainEventQuery
  ): Promise<TelemetryResult<{ events: DomainEvent[] }>> {
    const configured = await this.isConfigured();
    if (!configured) {
      return notConfigured('getDomainEvents() called before provider is set up.');
    }

    // TODO (future phase): implement NextDNS Logs API call here.
    // Placeholder so TypeScript is happy when isConfigured() returns true
    // (which it currently never does in this build).
    return {
      configured: true,
      events: [],
    };
  }

  /**
   * Fetch pre-aggregated daily domain rollup data.
   *
   * STUB: returns not-configured until NEXTDNS_API_KEY is set.
   *
   * Future implementation:
   *   NextDNS does not expose a pre-aggregated daily rollup endpoint.
   *   Implementors should fetch raw logs for the day and aggregate locally,
   *   or maintain app_domain_rollup_daily as a materialized view updated
   *   by the telemetry sync job.
   */
  async getDailyRollup(
    _deviceMac: string | undefined,
    _day: DateString
  ): Promise<TelemetryResult<{ rollups: DomainRollup[] }>> {
    const configured = await this.isConfigured();
    if (!configured) {
      return notConfigured('getDailyRollup() called before provider is set up.');
    }

    // TODO (future phase): aggregate from raw NextDNS logs for the given day.
    return {
      configured: true,
      rollups: [],
    };
  }

  /**
   * Fetch device presence estimates for a given day.
   *
   * STUB: returns not-configured until NEXTDNS_API_KEY is set.
   *
   * Future implementation:
   *   Derive from DNS query cadence in the day's logs:
   *   - Group log entries by clientIp (→ MAC).
   *   - Count distinct minutes with at least one query.
   *   - Store as connectedMinutes in app_device_presence.
   */
  async getDevicePresence(
    _deviceMac: string | undefined,
    _day: DateString
  ): Promise<TelemetryResult<{ presence: DevicePresence[] }>> {
    const configured = await this.isConfigured();
    if (!configured) {
      return notConfigured('getDevicePresence() called before provider is set up.');
    }

    // TODO (future phase): derive from NextDNS raw logs.
    return {
      configured: true,
      presence: [],
    };
  }
}
