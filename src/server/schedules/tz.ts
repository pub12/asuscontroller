/**
 * src/server/schedules/tz.ts
 *
 * AEST (Australia/Sydney) wall-time helpers.
 *
 * Uses Intl.DateTimeFormat with timeZone:'Australia/Sydney' to handle DST
 * automatically — no manual UTC+10/+11 offset arithmetic.
 *
 * No npm deps; relies only on built-in Intl APIs (Node 20+, all browsers).
 */

const TZ = 'Australia/Sydney';

// ---------------------------------------------------------------------------
// Internal: extract the UTC offset for a given instant in AEST.
//
// Strategy: format the instant as AEST parts, reconstruct a UTC instant from
// those parts (treating them as UTC), then compute the difference. That diff
// IS the UTC offset for that instant (positive = ahead of UTC).
// ---------------------------------------------------------------------------
function getAestOffsetMs(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  // Build a UTC timestamp from the AEST wall parts.
  const localAsUtcMs = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10),
  );
  return localAsUtcMs - date.getTime();
}

// ---------------------------------------------------------------------------
// Internal: construct an absolute UTC Date for a given AEST hh:mm on a
// specific AEST calendar date (expressed as a UTC Date falling on that day
// in AEST).
// ---------------------------------------------------------------------------
function aestHhmmToUtc(hhmm: string, aestDay: Date): Date {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? '0', 10);

  // Get the AEST calendar date for this day reference.
  const dateParts = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(aestDay);
  const dp = Object.fromEntries(dateParts.map((p) => [p.type, p.value]));

  // Build a "naively UTC" timestamp for that AEST wall time on that calendar date.
  const naiveUtcMs = Date.UTC(
    parseInt(dp.year, 10),
    parseInt(dp.month, 10) - 1,
    parseInt(dp.day, 10),
    h, m, 0, 0,
  );
  // Adjust by the AEST offset to get true UTC. Use the naive estimate as the
  // reference for offset lookup (close enough; DST transitions are 1-hour steps).
  const naiveDate = new Date(naiveUtcMs);
  const offsetMs = getAestOffsetMs(naiveDate);
  return new Date(naiveUtcMs - offsetMs);
}

// ---------------------------------------------------------------------------
// Public: untilTimeToISO
//
// Given "21:00" (AEST wall time), return the ISO instant of the NEXT
// occurrence of that wall time at or after `from` (default: now).
//
// Examples (AEST = UTC+11 in summer, UTC+10 in winter):
//   untilTimeToISO("21:00") during summer → "2025-06-21T10:00:00.000Z"
//   untilTimeToISO("21:00") when it's already past 21:00 AEST → tomorrow
// ---------------------------------------------------------------------------
export function untilTimeToISO(hhmm: string, from?: Date): string {
  const ref = from ?? new Date();
  const candidate = aestHhmmToUtc(hhmm, ref);
  // If the target instant is in the past (or within the same second), advance
  // to the same wall time tomorrow.
  if (candidate.getTime() <= ref.getTime()) {
    const tomorrow = new Date(ref.getTime() + 24 * 60 * 60 * 1000);
    return aestHhmmToUtc(hhmm, tomorrow).toISOString();
  }
  return candidate.toISOString();
}

// ---------------------------------------------------------------------------
// Public: durationToISO
//
// now + durationMin minutes → ISO instant (UTC). Timezone-independent.
//
// Example: durationToISO(30) → now + 30 min as ISO string
// ---------------------------------------------------------------------------
export function durationToISO(durationMin: number, from?: Date): string {
  const ref = from ?? new Date();
  return new Date(ref.getTime() + durationMin * 60 * 1000).toISOString();
}
