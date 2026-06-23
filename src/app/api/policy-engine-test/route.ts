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

  // Empty rules -> defaultAction (default 'unblock'); next is still null.
  checks.empty_state = policyState([], monWinter17) === 'unblock';
  checks.empty_next = nextTransition([], monWinter17) === null;

  // Default-action cases.
  checks.empty_default_block = policyState([], monWinter17, 'Australia/Melbourne', 'block') === 'block';

  // default='unblock', one block window 14:00–16:00 Mon: inside → blocked, outside → unblocked.
  const blockWin: PolicyRule[] = [
    { weekday: 0, time_min: 840, action: 'block' },
    { weekday: 0, time_min: 960, action: 'unblock' },
  ];
  const monWinter15 = Date.parse('2026-06-22T05:00:00.000Z'); // 15:00 AEST
  checks.default_unblock_inside_block_win = policyState(blockWin, monWinter15, 'Australia/Melbourne', 'unblock') === 'block';
  checks.default_unblock_outside_block_win = policyState(blockWin, monWinter17, 'Australia/Melbourne', 'unblock') === 'unblock';

  // Overnight window: block 22:00 Mon – 02:00 Tue (default='unblock').
  // Enter: Mon weekday 0 @1320 → 'block'; Exit: Tue weekday 1 @120 → 'unblock'.
  const overnightRules: PolicyRule[] = [
    { weekday: 0, time_min: 1320, action: 'block' },
    { weekday: 1, time_min: 120, action: 'unblock' },
  ];
  const monWinter23 = Date.parse('2026-06-22T13:00:00.000Z'); // 23:00 AEST Mon
  const tue01 = Date.parse('2026-06-22T15:00:00.000Z');       // 01:00 AEST Tue
  const tue03 = Date.parse('2026-06-22T17:00:00.000Z');       // 03:00 AEST Tue
  checks.overnight_inside = policyState(overnightRules, monWinter23, 'Australia/Melbourne', 'unblock') === 'block';
  checks.overnight_still_inside = policyState(overnightRules, tue01, 'Australia/Melbourne', 'unblock') === 'block';
  checks.overnight_after = policyState(overnightRules, tue03, 'Australia/Melbourne', 'unblock') === 'unblock';

  // DST: AEDT (UTC+11) summer. Mon 2026-01-05 17:00 Melbourne = 06:00Z.
  const monSummer17 = Date.parse('2026-01-05T06:00:00.000Z');
  checks.dst_inside_unblocked = policyState(allowWin, monSummer17) === 'unblock';
  checks.dst_next_block = nextTransition(allowWin, monSummer17) === Date.parse('2026-01-05T07:00:00.000Z'); // 18:00 AEDT

  const all_ok = Object.values(checks).every(Boolean);
  return Response.json({ all_ok, checks });
}
