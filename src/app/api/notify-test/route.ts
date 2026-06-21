/**
 * src/app/api/notify-test/route.ts
 *
 * Hermetic service-level test for NotifyProvider.
 * Uses injected fake `send` and injected `now` clock — zero real network calls.
 *
 * Returns 404 in production.
 */

import { createNotifyProvider, isNotifyConfigured } from '@/server/notify/NotifyProvider';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  try {
    // -------------------------------------------------------------------------
    // Check 1: sends_when_configured_ok
    // A recording fake send → alert({title:'t'}) → fake called exactly once,
    // text contains 't'.
    // -------------------------------------------------------------------------
    let sends_when_configured_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({
        send: async (text) => { calls.push(text); },
      });
      await provider.alert({ title: 't' });
      sends_when_configured_ok = calls.length === 1 && calls[0].includes('t');
    }

    // -------------------------------------------------------------------------
    // Check 2: dedupe_suppresses_ok
    // Two alerts with the same dedupeKey inside window → sent ONCE.
    // Third alert after advancing past dedupeWindowMs → sent again (total 2).
    // -------------------------------------------------------------------------
    let dedupe_suppresses_ok = false;
    {
      let fakeNow = 1_000_000;
      const calls: string[] = [];
      const dedupeWindowMs = 60_000;
      const provider = createNotifyProvider({
        send: async (text) => { calls.push(text); },
        dedupeWindowMs,
        now: () => fakeNow,
      });

      await provider.alert({ title: 'first', dedupeKey: 'k' });   // sent → 1
      await provider.alert({ title: 'second', dedupeKey: 'k' });  // suppressed
      fakeNow += dedupeWindowMs + 1;
      await provider.alert({ title: 'third', dedupeKey: 'k' });   // sent → 2

      dedupe_suppresses_ok = calls.length === 2;
    }

    // -------------------------------------------------------------------------
    // Check 3: no_dedupe_key_always_sends_ok
    // Two alerts with no dedupeKey → both sent (no suppression).
    // -------------------------------------------------------------------------
    let no_dedupe_key_always_sends_ok = false;
    {
      const calls: string[] = [];
      const provider = createNotifyProvider({
        send: async (text) => { calls.push(text); },
      });
      await provider.alert({ title: 'a' });
      await provider.alert({ title: 'b' });
      no_dedupe_key_always_sends_ok = calls.length === 2;
    }

    // -------------------------------------------------------------------------
    // Check 4: swallows_send_errors_ok
    // A fake send that throws → alert() still resolves (error swallowed).
    // -------------------------------------------------------------------------
    let swallows_send_errors_ok = false;
    {
      const provider = createNotifyProvider({
        send: async () => { throw new Error('boom'); },
      });
      let threw = false;
      try {
        await provider.alert({ title: 'will fail' });
      } catch {
        threw = true;
      }
      swallows_send_errors_ok = !threw;
    }

    // -------------------------------------------------------------------------
    // Check 5: noop_unconfigured_ok
    // When TELEGRAM_* are absent the default send path is a no-op;
    // alert() resolves without throwing or hitting the network.
    // If env happens to be configured, just assert isNotifyConfigured() returns
    // a boolean and the default-send alert still resolves cleanly.
    // -------------------------------------------------------------------------
    let noop_unconfigured_ok = false;
    {
      if (!isNotifyConfigured()) {
        // Build a provider using the DEFAULT send (no opts.send) — relies on the
        // no-op path since env is unset.
        const provider = createNotifyProvider();
        let threw = false;
        try {
          await provider.alert({ title: 'noop check' });
        } catch {
          threw = true;
        }
        noop_unconfigured_ok = !threw;
      } else {
        // Env IS set — verify isNotifyConfigured() returns a boolean and a
        // provider with an injected fake send still resolves.
        const configured = isNotifyConfigured();
        const calls: string[] = [];
        const provider = createNotifyProvider({
          send: async (text) => { calls.push(text); },
        });
        let threw = false;
        try {
          await provider.alert({ title: 'env-set check' });
        } catch {
          threw = true;
        }
        noop_unconfigured_ok = typeof configured === 'boolean' && !threw && calls.length === 1;
      }
    }

    const all_ok =
      sends_when_configured_ok &&
      dedupe_suppresses_ok &&
      no_dedupe_key_always_sends_ok &&
      swallows_send_errors_ok &&
      noop_unconfigured_ok;

    return Response.json({
      ok: true,
      all_ok,
      sends_when_configured_ok,
      dedupe_suppresses_ok,
      no_dedupe_key_always_sends_ok,
      swallows_send_errors_ok,
      noop_unconfigured_ok,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
