/**
 * src/server/notify/NotifyProvider.ts
 *
 * Ops-alerting seam for DarylWeb.
 *
 * NOTE: hazo_notify is an email-templating package (send_template_email,
 * handlebars rendering, categories) — it has NO generic alert or Telegram
 * primitive. Ops alerts therefore go Telegram-direct via the Bot API.
 * When TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are unset the provider degrades
 * to a silent no-op so ops alerting never breaks the worker or a request.
 *
 * No 'server-only' guard — this module is imported by both the worker (ESM
 * .mjs via dynamic import) and potentially API routes. Keep it dependency-
 * light: only process.env + fetch, no hazo imports.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NotifyAlert {
  title: string;
  body?: string;
  /** When set, suppresses repeated sends within dedupeWindowMs. */
  dedupeKey?: string;
}

export interface NotifyProvider {
  alert(a: NotifyAlert): Promise<void>;
}

export interface NotifyProviderOptions {
  /** Injectable transport for tests; defaults to telegram-or-noop from env. */
  send?: (text: string) => Promise<void>;
  /** How long to suppress duplicate dedupeKey alerts. Default: 5 minutes. */
  dedupeWindowMs?: number;
  /** Injectable clock for tests. Default: Date.now. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// isNotifyConfigured
// ---------------------------------------------------------------------------

/** Returns true iff both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. */
export function isNotifyConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// ---------------------------------------------------------------------------
// Default Telegram transport
// ---------------------------------------------------------------------------

function buildTelegramSend(): (text: string) => Promise<void> {
  if (!isNotifyConfigured()) {
    // No-op — env is unset; ops alerting is optional.
    return async (_text: string) => {};
  }

  const token = process.env.TELEGRAM_BOT_TOKEN as string;
  const chatId = process.env.TELEGRAM_CHAT_ID as string;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return async (text: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // Soft failure — non-2xx is treated as best-effort; caller swallows.
      console.warn(`[notify] telegram responded ${res.status}: ${await res.text().catch(() => '(unreadable)')}`);
    }
  };
}

// ---------------------------------------------------------------------------
// createNotifyProvider
// ---------------------------------------------------------------------------

/**
 * Creates a NotifyProvider. Each call gets its own dedupe Map so tests are
 * isolated from one another.
 */
export function createNotifyProvider(opts?: NotifyProviderOptions): NotifyProvider {
  const send = opts?.send ?? buildTelegramSend();
  const dedupeWindowMs = opts?.dedupeWindowMs ?? 5 * 60_000;
  const now = opts?.now ?? (() => Date.now());

  // Per-instance dedupe map: dedupeKey → timestamp of last sent message.
  const lastSent = new Map<string, number>();

  return {
    async alert(a: NotifyAlert): Promise<void> {
      // 1. Dedupe check.
      if (a.dedupeKey !== undefined) {
        const last = lastSent.get(a.dedupeKey);
        if (last !== undefined && now() - last < dedupeWindowMs) {
          return; // Suppressed — within window.
        }
        lastSent.set(a.dedupeKey, now());
      }

      // 2. Build message text.
      const text = a.body ? `${a.title}\n${a.body}` : a.title;

      // 3. Send — swallow any error so ops alerting never breaks the caller.
      try {
        await send(text);
      } catch (err) {
        console.warn(`[notify] alert failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shared singleton accessor (for request paths / routes)
// ---------------------------------------------------------------------------

let _shared: NotifyProvider | null = null;

/** Lazy process-wide provider for request paths (routes). Reuses one dedupe map. */
export function getSharedNotifyProvider(): NotifyProvider {
  if (_shared === null) _shared = createNotifyProvider();
  return _shared;
}
