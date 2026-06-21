/**
 * src/server/notify/events.ts
 *
 * Domain-event → NotifyAlert mapping helpers.
 *
 * Each helper accepts a NotifyProvider explicitly so tests can inject a
 * recording fake without touching the shared singleton.
 *
 * Messages are plain-text-safe: free-text labels are run through esc() before
 * interpolation so a device friendly_name cannot inject HTML markup (the
 * Telegram transport uses parse_mode: HTML).
 *
 * All helpers are best-effort: they delegate to provider.alert() which already
 * swallows errors and no-ops when TELEGRAM_* are unset.
 */

import type { NotifyProvider } from './NotifyProvider';

// ---------------------------------------------------------------------------
// Minimal HTML-escape for user-controlled strings
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// notifyDeviceBlock
// ---------------------------------------------------------------------------

export async function notifyDeviceBlock(
  provider: NotifyProvider,
  args: { action: 'block' | 'unblock'; deviceLabel: string; actor: string },
): Promise<void> {
  const title = args.action === 'block' ? '🔒 Device blocked' : '🔓 Device unblocked';
  const body = `${esc(args.deviceLabel)} by ${esc(args.actor)}`;
  await provider.alert({ title, body });
}

// ---------------------------------------------------------------------------
// notifyGroupBlockAll
// ---------------------------------------------------------------------------

export async function notifyGroupBlockAll(
  provider: NotifyProvider,
  args: {
    action: 'block' | 'unblock';
    groupId: string;
    memberCount: number;
    affectedCount: number;
    actor: string;
  },
): Promise<void> {
  const title = args.action === 'block' ? '🔒 Group block-all' : '🔓 Group unblock-all';
  const body = `group ${esc(args.groupId)}: ${args.affectedCount}/${args.memberCount} affected, by ${esc(args.actor)}`;
  await provider.alert({ title, body });
}

// ---------------------------------------------------------------------------
// notifyNewDevices
// ---------------------------------------------------------------------------

export async function notifyNewDevices(
  provider: NotifyProvider,
  args: { count: number },
): Promise<void> {
  if (args.count <= 0) return;
  const title = '🆕 New device(s) joined';
  const body = `${args.count} new device(s) seen on the network`;
  await provider.alert({ title, body });
}

// ---------------------------------------------------------------------------
// notifyScheduleFired
// ---------------------------------------------------------------------------

export async function notifyScheduleFired(
  provider: NotifyProvider,
  args: { action: 'block' | 'unblock'; targetType: 'device' | 'group'; targetId: string; affected: number },
): Promise<void> {
  const title = args.action === 'block' ? '⏰ Schedule fired — blocked' : '⏰ Schedule fired — unblocked';
  const body = `${args.targetType} ${esc(args.targetId)} (${args.affected} affected)`;
  await provider.alert({ title, body });
}

// ---------------------------------------------------------------------------
// notifyTelemetryGap
// ---------------------------------------------------------------------------

export async function notifyTelemetryGap(
  provider: NotifyProvider,
  args: { reason: string },
): Promise<void> {
  const title = '🟡 Telemetry gap — ingest not configured';
  const body = `Telemetry ingest skipped: ${esc(args.reason)}`;
  await provider.alert({ title, body, dedupeKey: 'telemetry-gap' });
}
