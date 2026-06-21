import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityItem {
  kind: 'event' | 'field';
  occurred_at: string;
  event_name?: string;            // kind=event
  field_path?: string;            // kind=field
  op?: string;                    // kind=field: insert|update|delete
  before_value?: string | null;   // kind=field
  after_value?: string | null;    // kind=field
  actor_kind: string;
  actor_label: string | null;
  payload?: unknown;              // kind=event: parsed JSON
}

export interface DevicePresenceSummary {
  todayMinutes: number;
  last7Minutes: number;
  allTimeMinutes: number;
  byDay: { day: string; connected_minutes: number }[]; // recent first, up to 14
}

export interface DeviceActivity {
  presence: DevicePresenceSummary;
  timeline: ActivityItem[];       // merged event+field, occurred_at DESC, up to 50
}

// ---------------------------------------------------------------------------
// Adapter shim (rawQuery uses { params } at runtime under SQLite)
// ---------------------------------------------------------------------------
type RawAdapter = {
  rawQuery(sql: string, options?: { params?: unknown[] }): Promise<unknown[]>;
};

// ---------------------------------------------------------------------------
// getDeviceActivity
// ---------------------------------------------------------------------------

/**
 * Fetch presence + audit timeline for a single device.
 *
 * @param adapter   HazoConnectAdapter (cast to RawAdapter internally for rawQuery)
 * @param deviceId  The device id to query
 * @param todayIso  'YYYY-MM-DD' — injected by caller so tests can control "today"
 */
export async function getDeviceActivity(
  adapter: HazoConnectAdapter,
  deviceId: string,
  todayIso: string,
): Promise<DeviceActivity> {
  const raw = adapter as unknown as RawAdapter;

  // ---- Presence ----
  const presRows = (await raw.rawQuery(
    `SELECT day, connected_minutes FROM app_device_presence WHERE device_id = ? ORDER BY day DESC`,
    { params: [deviceId] },
  )) as { day: string; connected_minutes: number }[];

  let todayMinutes = 0;
  let allTimeMinutes = 0;
  let last7Minutes = 0;

  for (let i = 0; i < presRows.length; i++) {
    const r = presRows[i];
    const mins = Number(r.connected_minutes) || 0;
    allTimeMinutes += mins;
    if (r.day === todayIso) todayMinutes = mins;
    if (i < 7) last7Minutes += mins; // rows already sorted DESC — top 7 are most recent
  }

  const byDay = presRows.slice(0, 14).map((r) => ({
    day: r.day,
    connected_minutes: Number(r.connected_minutes) || 0,
  }));

  // ---- Timeline events (intent) ----
  const intentRows = (await raw.rawQuery(
    `SELECT event_name, payload, actor_kind, actor_label, occurred_at
     FROM hazo_audit_intent
     WHERE subject_id = ? AND subject_kind = 'device'
     ORDER BY occurred_at DESC
     LIMIT 50`,
    { params: [deviceId] },
  )) as {
    event_name: string;
    payload: string | null;
    actor_kind: string;
    actor_label: string | null;
    occurred_at: string;
  }[];

  const eventItems: ActivityItem[] = intentRows.map((r) => {
    let parsedPayload: unknown = null;
    if (r.payload) {
      try {
        parsedPayload = JSON.parse(r.payload);
      } catch {
        parsedPayload = null;
      }
    }
    return {
      kind: 'event' as const,
      occurred_at: r.occurred_at,
      event_name: r.event_name,
      actor_kind: r.actor_kind,
      actor_label: r.actor_label,
      payload: parsedPayload,
    };
  });

  // ---- Timeline fields (field diffs) ----
  const fieldRows = (await raw.rawQuery(
    `SELECT field_path, op, before_value, after_value, actor_kind, actor_label, occurred_at, is_sensitive
     FROM hazo_audit_field
     WHERE subject_id = ? AND subject_kind = 'device'
     ORDER BY occurred_at DESC
     LIMIT 50`,
    { params: [deviceId] },
  )) as {
    field_path: string;
    op: string;
    before_value: string | null;
    after_value: string | null;
    actor_kind: string;
    actor_label: string | null;
    occurred_at: string;
    is_sensitive: number | null;
  }[];

  const fieldItems: ActivityItem[] = fieldRows
    .filter((r) => Number(r.is_sensitive) !== 1)
    .map((r) => ({
      kind: 'field' as const,
      occurred_at: r.occurred_at,
      field_path: r.field_path,
      op: r.op,
      before_value: r.before_value,
      after_value: r.after_value,
      actor_kind: r.actor_kind,
      actor_label: r.actor_label,
    }));

  // ---- Merge + sort DESC + slice to 50 ----
  const timeline = [...eventItems, ...fieldItems]
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0))
    .slice(0, 50);

  return {
    presence: { todayMinutes, last7Minutes, allTimeMinutes, byDay },
    timeline,
  };
}
