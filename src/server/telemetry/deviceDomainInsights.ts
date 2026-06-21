import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopDomain {
  domain: string;
  count: number;
  blockedCount: number;
  lastSeen: string;
}

export interface DomainTimelineItem {
  domain: string;
  ts: string;
  blocked: boolean;
}

export interface DomainInsights {
  monitoringEnabled: boolean;
  topDomains: TopDomain[];
  timeline: DomainTimelineItem[];
  firstSeen: string | null;
  lastSeen: string | null;
  totalQueries: number;
}

// ---------------------------------------------------------------------------
// Adapter shim (rawQuery uses { params } at runtime under SQLite)
// ---------------------------------------------------------------------------
type RawAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<unknown[]>;
};

// ---------------------------------------------------------------------------
// getDeviceDomainInsights
// ---------------------------------------------------------------------------

/**
 * Fetch per-device domain insights (top domains + timeline) from app_domain_events.
 *
 * @param adapter   HazoConnectAdapter (cast to RawAdapter internally for rawQuery)
 * @param deviceId  The device id to query
 * @param todayIso  'YYYY-MM-DD' — injected by caller so tests can control "today" (UTC day)
 * @param range     'today' restricts to the current day; '7d' covers the last 7 calendar days
 */
export async function getDeviceDomainInsights(
  adapter: HazoConnectAdapter,
  deviceId: string,
  todayIso: string,
  range: 'today' | '7d',
): Promise<DomainInsights> {
  const raw = adapter as unknown as RawAdapter;

  // ---- 1. Privacy gate — check monitoring_enabled BEFORE reading any events ----
  const gateRows = (await raw.rawQuery(
    `SELECT COALESCE(g.monitoring_enabled, 1) AS me
     FROM app_devices d LEFT JOIN app_groups g ON g.id = d.primary_group_id
     WHERE d.id = ?`,
    { params: [deviceId] },
  )) as { me: number | string | null }[];

  const me = Number(gateRows[0]?.me ?? 1);
  if (me === 0) {
    return {
      monitoringEnabled: false,
      topDomains: [],
      timeline: [],
      firstSeen: null,
      lastSeen: null,
      totalQueries: 0,
    };
  }

  // ---- 2. Compute window lower bound ----
  const from =
    range === 'today'
      ? `${todayIso}T00:00:00.000Z`
      : new Date(Date.parse(`${todayIso}T00:00:00.000Z`) - 6 * 86400000).toISOString();

  // ---- 3. Top domains ----
  const topRows = (await raw.rawQuery(
    `SELECT domain, COUNT(*) AS count, SUM(blocked) AS blockedCount, MAX(ts) AS lastSeen
     FROM app_domain_events WHERE device_id = ? AND ts >= ?
     GROUP BY domain ORDER BY count DESC LIMIT 15`,
    { params: [deviceId, from] },
  )) as { domain: string; count: number | string; blockedCount: number | string; lastSeen: string }[];

  const topDomains: TopDomain[] = topRows.map((r) => ({
    domain: r.domain,
    count: Number(r.count),
    blockedCount: Number(r.blockedCount),
    lastSeen: r.lastSeen,
  }));

  // ---- 4. Recent timeline ----
  const timelineRows = (await raw.rawQuery(
    `SELECT domain, ts, blocked FROM app_domain_events
     WHERE device_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 50`,
    { params: [deviceId, from] },
  )) as { domain: string; ts: string; blocked: number | string }[];

  const timeline: DomainTimelineItem[] = timelineRows.map((r) => ({
    domain: r.domain,
    ts: r.ts,
    blocked: Number(r.blocked) === 1,
  }));

  // ---- 5. Totals ----
  const totalsRows = (await raw.rawQuery(
    `SELECT MIN(ts) AS firstSeen, MAX(ts) AS lastSeen, COUNT(*) AS totalQueries
     FROM app_domain_events WHERE device_id = ? AND ts >= ?`,
    { params: [deviceId, from] },
  )) as { firstSeen: string | null; lastSeen: string | null; totalQueries: number | string }[];

  const totals = totalsRows[0];
  const firstSeen = totals?.firstSeen ?? null;
  const lastSeen = totals?.lastSeen ?? null;
  const totalQueries = Number(totals?.totalQueries ?? 0);

  return {
    monitoringEnabled: true,
    topDomains,
    timeline,
    firstSeen,
    lastSeen,
    totalQueries,
  };
}
