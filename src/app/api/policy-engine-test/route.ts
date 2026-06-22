/**
 * src/app/api/policy-engine-test/route.ts
 * Hermetic autotest for the pure schedule engine (policyState / nextTransition).
 * Returns 404 in production.
 */
import { policyState, nextTransition, type PolicyRule } from '@/server/sync/runDeviceSync';

export async function GET() {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });

  const checks: Record<string, boolean> = {};

  // "Blocked all day, allow 16:00-18:00" on Mon (weekday 0): unblock@960, block@1080.
  const allowWin: PolicyRule[] = [
    { weekday: 0, time_min: 960, action: 'unblock' },
    { weekday: 0, time_min: 1080, action: 'block' },
  ];
  // A Monday 17:00 Melbourne instant (winter, AEST = UTC+10) -> 07:00Z.
  const monWinter17 = Date.parse('2026-06-22T07:00:00.000Z'); // 2026-06-22 is a Monday
  checks.inside_window_unblocked = policyState(allowWin, monWinter17) === 'unblock';
  // Monday 12:00 (02:00Z) — before the unblock; most recent transition wraps to last week's block.
  const monWinter12 = Date.parse('2026-06-22T02:00:00.000Z');
  checks.before_window_blocked = policyState(allowWin, monWinter12) === 'block';
  // Next transition from 17:00 is the 18:00 block (08:00Z same day).
  checks.next_is_block = nextTransition(allowWin, monWinter17) === Date.parse('2026-06-22T08:00:00.000Z');

  // Wrap-around: rules only on Monday; evaluating on Wednesday must look back to Monday.
  const wed = Date.parse('2026-06-24T02:00:00.000Z');
  checks.wraparound_state = policyState(allowWin, wed) === 'block';
  checks.wraparound_next = nextTransition(allowWin, wed) === Date.parse('2026-06-29T06:00:00.000Z'); // next Mon 16:00 AEST

  // Empty rules -> null.
  checks.empty_state = policyState([], monWinter17) === null;
  checks.empty_next = nextTransition([], monWinter17) === null;

  // DST: AEDT (UTC+11) summer. Mon 2026-01-05 17:00 Melbourne = 06:00Z.
  const monSummer17 = Date.parse('2026-01-05T06:00:00.000Z');
  checks.dst_inside_unblocked = policyState(allowWin, monSummer17) === 'unblock';
  checks.dst_next_block = nextTransition(allowWin, monSummer17) === Date.parse('2026-01-05T07:00:00.000Z'); // 18:00 AEDT

  const all_ok = Object.values(checks).every(Boolean);
  return Response.json({ all_ok, checks });
}
