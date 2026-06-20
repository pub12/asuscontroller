/**
 * src/server/router/parseAsusClientList.ts
 *
 * Pure parser for the ASUS `appGet.cgi?hook=get_clientlist()` response.
 *
 * IMPORTANT CONSTRAINTS (mirror runDeviceSync.ts):
 *  - NO `import 'server-only'` and NO runtime value imports. Only a type-only
 *    import of RouterClient (erased at runtime). This lets the plain-Node sync
 *    script import it directly under `node --input-type=module` type-stripping,
 *    while AsusWrtProvider (server-only) imports the very same logic. One source
 *    of truth for the wire format.
 *
 * Real wire format (verified against ZenWiFi stock firmware, 2026-06):
 *   {
 *     "get_clientlist": {
 *       "AA:BB:CC:DD:EE:FF": { name, nickName, ip, mac, vendor,
 *                              isOnline: "1"|"0", isWL: "0"|"1"|"2"|"3", ... },
 *       ...,
 *       "maclist": [...],         // non-MAC keys — must be skipped
 *       "ClientAPILevel": "..."
 *     }
 *   }
 *
 * The older `<mac><ip><name>...` angle-bracket format documented in early
 * drafts does NOT match this firmware — do not reintroduce it.
 */

import type { RouterClient } from './RouterProvider';

/** Matches an `AA:BB:CC:DD:EE:FF` style key (the only entries that are devices). */
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

/**
 * Map the ASUS `isWL` connection-type code to a display band label.
 *   "0" → wired, "1" → 2.4GHz, "2" → 5GHz, "3" → 6GHz (tri-band).
 * Unknown values yield "" rather than guessing.
 */
export function bandFromIsWL(isWL: unknown): string {
  switch (String(isWL)) {
    case '0':
      return 'wired';
    case '1':
      return '2G';
    case '2':
      return '5G';
    case '3':
      return '6G';
    default:
      return '';
  }
}

type RawEntry = Record<string, unknown>;

/**
 * Parse the `get_clientlist` payload into RouterClient records.
 *
 * Accepts either the full response object (`{ get_clientlist: {...} }`) or the
 * inner map directly. Returns ONLY currently-connected clients (`isOnline === "1"`),
 * because runDeviceSync treats every returned client as online and reconciles
 * absent devices to offline — handing it offline rows would mislabel them.
 *
 * Display name preference: nickName (the user's ASUS-app label) → name
 * (client-reported hostname) → a short MAC-derived fallback so the row is never
 * blank.
 */
export function parseAsusClientList(payload: unknown): RouterClient[] {
  if (payload == null || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;
  const map = (
    'get_clientlist' in root && root['get_clientlist'] && typeof root['get_clientlist'] === 'object'
      ? root['get_clientlist']
      : root
  ) as Record<string, unknown>;

  const clients: RouterClient[] = [];

  for (const [key, value] of Object.entries(map)) {
    if (!MAC_RE.test(key)) continue; // skip "maclist", "ClientAPILevel", etc.
    if (value == null || typeof value !== 'object') continue;

    const e = value as RawEntry;
    if (String(e['isOnline']) !== '1') continue; // connected devices only

    const mac = (typeof e['mac'] === 'string' && e['mac'] ? e['mac'] : key).toUpperCase();
    const nickName = typeof e['nickName'] === 'string' ? e['nickName'].trim() : '';
    const name = typeof e['name'] === 'string' ? e['name'].trim() : '';
    const ip = typeof e['ip'] === 'string' ? e['ip'] : '';
    const vendor = typeof e['vendor'] === 'string' ? e['vendor'] : '';

    const displayName = nickName || name || `device-${mac.replace(/:/g, '').slice(-6)}`;

    clients.push({
      mac,
      ip,
      name: displayName,
      connected: true,
      band: bandFromIsWL(e['isWL']),
      vendor,
    });
  }

  return clients;
}
