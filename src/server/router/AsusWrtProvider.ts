/**
 * STAGED DRAFT — not wired, not executed.
 * Verify against live hardware in a supervised session.
 *
 * src/server/router/AsusWrtProvider.ts — Draft implementation of RouterProvider
 * for stock ASUS firmware (ASUSWRT) using the undocumented CGI API.
 *
 * Stock firmware CGI endpoints:
 *   POST /login.cgi          — exchange credentials for asus_token
 *   GET  /appGet.cgi         — read hooks (get_clientlist, etc.)
 *   POST /applyapp.cgi       — write hooks (set_client_state, reboot, etc.)
 *
 * This file compiles and is correct-by-reading but is NEVER instantiated or
 * called during builds, tests, or the running app. It is wired exclusively
 * during supervised spike sessions using scripts/spike-router.mjs.
 *
 * DO NOT import this file from any route, layout, autotest, or shared lib.
 */
import 'server-only';
import { getRouterCredentials } from '../secrets.js';
import type {
  RouterProvider,
  RouterClient,
  AccessResult,
  CapabilityMap,
} from './RouterProvider.js';

// ---------------------------------------------------------------------------
// Internal helpers / constants
// ---------------------------------------------------------------------------

/**
 * Default token TTL assumed for stock ASUS firmware.
 * The real expiry is not reliably reported in the login response — verify
 * during the spike and adjust if the router returns an explicit expiry.
 */
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Raw entry from the router's get_clientlist NVRAM string.
 * The format is semicolon-delimited, each record uses angle-bracket fields:
 *   <mac><ip><name><connected><band><vendor>
 * but the exact separator and field count vary by firmware version.
 * This is the format verified on ASUSWRT 3.0.0.x / ZenWiFi — confirm during spike.
 */
interface RawClientEntry {
  mac: string;
  ip: string;
  name: string;
  connected: string; // "1" or "0"
  band: string;      // "2G", "5G", "6G", or ""
  vendor: string;
}

/**
 * Parse the raw nvram get_clientlist string from the router.
 *
 * Example raw value (one client):
 *   <AA:BB:CC:DD:EE:FF><192.168.1.100><MyPhone><1><5G><Apple, Inc.>
 *
 * Multiple clients are separated by semicolons or newlines — verify delimiter
 * during the supervised spike session.
 */
function parseClientList(raw: string): RouterClient[] {
  if (!raw || raw.trim() === '') return [];

  // Split on semicolons (observed delimiter on ZenWiFi firmware).
  // Fall back to newlines if no semicolons found.
  const delimiter = raw.includes(';') ? ';' : '\n';
  const records = raw.split(delimiter).map((r) => r.trim()).filter(Boolean);

  const clients: RouterClient[] = [];

  for (const record of records) {
    // Each field is wrapped in angle brackets: <field>
    const matches = record.match(/<([^>]*)>/g);
    if (!matches || matches.length < 3) continue;

    // Strip the angle brackets from each match
    const fields = matches.map((m) => m.slice(1, -1));

    const entry: RawClientEntry = {
      mac: fields[0] ?? '',
      ip: fields[1] ?? '',
      name: fields[2] ?? '',
      connected: fields[3] ?? '0',
      band: fields[4] ?? '',
      vendor: fields[5] ?? '',
    };

    if (!entry.mac) continue;

    clients.push({
      mac: entry.mac.toUpperCase(),
      ip: entry.ip,
      name: entry.name,
      connected: entry.connected === '1',
      band: entry.band,
      vendor: entry.vendor,
    });
  }

  return clients;
}

/**
 * Encode credentials as base64 for the ASUS login_authorization header.
 * Stock firmware expects: base64("<username>:<password>")
 */
function encodeCredentials(user: string, pass: string): string {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

// ---------------------------------------------------------------------------
// AsusWrtProvider
// ---------------------------------------------------------------------------

/**
 * Draft implementation of RouterProvider for stock ASUS firmware.
 *
 * Instantiation example (supervised spike only):
 *   const router = new AsusWrtProvider();
 *   await router.login();
 *   const clients = await router.getClientList();
 */
export class AsusWrtProvider implements RouterProvider {
  /** Acquired session token (asus_token cookie value). */
  private token: string | null = null;

  /** Timestamp (Date.now()) when the current token was acquired. */
  private tokenAcquiredAt: number | null = null;

  /** Assumed TTL in ms — update if the spike reveals the real expiry. */
  private tokenTtlMs: number = DEFAULT_TOKEN_TTL_MS;

  // -------------------------------------------------------------------------
  // Auth / token lifecycle
  // -------------------------------------------------------------------------

  /**
   * Authenticate with the router.
   *
   * POST /login.cgi
   *   Content-Type: application/x-www-form-urlencoded
   *   Body: login_authorization=<base64(user:pass)>
   *
   * On success the router returns a JSON body containing the token:
   *   { asus_token: "<token>" }
   * and may also set it as a cookie. We capture the body value.
   *
   * @throws Error if credentials are missing or the login fails.
   */
  async login(): Promise<void> {
    const { host, user, pass } = await getRouterCredentials();

    if (!host || !user || !pass) {
      throw new Error(
        'AsusWrtProvider.login(): missing credentials. ' +
          'Set ROUTER_HOST, ROUTER_USER, ROUTER_PASS in the environment.'
      );
    }

    const url = `http://${host}/login.cgi`;
    const body = new URLSearchParams({
      login_authorization: encodeCredentials(user, pass),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NetWarden/0.1 (spike)',
        Referer: `http://${host}/`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `AsusWrtProvider.login(): HTTP ${response.status} from ${url}`
      );
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(
        'AsusWrtProvider.login(): could not parse login response as JSON. ' +
          'Verify the stock firmware login endpoint during the spike.'
      );
    }

    const token = typeof json['asus_token'] === 'string' ? json['asus_token'] : null;
    if (!token) {
      throw new Error(
        'AsusWrtProvider.login(): asus_token not found in login response. ' +
          `Response keys: ${Object.keys(json).join(', ')}`
      );
    }

    this.token = token;
    this.tokenAcquiredAt = Date.now();

    console.log(
      `[AsusWrtProvider] Logged in. Token acquired at ${new Date(this.tokenAcquiredAt).toISOString()}. ` +
        `Assumed TTL: ${this.tokenTtlMs / 1000}s (verify during spike).`
    );
  }

  /**
   * Whether the in-memory token is believed to be valid (not expired).
   */
  isAuthenticated(): boolean {
    if (!this.token || this.tokenAcquiredAt === null) return false;
    return Date.now() - this.tokenAcquiredAt < this.tokenTtlMs;
  }

  /**
   * Return the request headers that include the session token.
   * @throws Error if not authenticated.
   */
  private authHeaders(host: string): Record<string, string> {
    if (!this.token) {
      throw new Error(
        'AsusWrtProvider: not authenticated. Call login() first.'
      );
    }
    return {
      Cookie: `asus_token=${this.token}`,
      'User-Agent': 'NetWarden/0.1 (spike)',
      Referer: `http://${host}/`,
    };
  }

  // -------------------------------------------------------------------------
  // Read — client list
  // -------------------------------------------------------------------------

  /**
   * Fetch the connected client list from the router.
   *
   * GET /appGet.cgi?hook=get_clientlist()
   *   Cookie: asus_token=<token>
   *
   * Response JSON:
   *   { get_clientlist: "<raw nvram string>" }
   *
   * The raw string format is:
   *   <MAC><IP><Name><Connected><Band><Vendor>;<MAC><IP>...
   *
   * See parseClientList() for the parsing logic — verify the exact format
   * against the real router during the spike.
   *
   * @throws Error if not authenticated or the request fails.
   */
  async getClientList(): Promise<RouterClient[]> {
    const { host } = await getRouterCredentials();

    if (!host) {
      throw new Error(
        'AsusWrtProvider.getClientList(): ROUTER_HOST not set.'
      );
    }

    const url = `http://${host}/appGet.cgi?hook=get_clientlist()`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(host),
    });

    if (!response.ok) {
      throw new Error(
        `AsusWrtProvider.getClientList(): HTTP ${response.status} from ${url}`
      );
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(
        'AsusWrtProvider.getClientList(): could not parse response as JSON.'
      );
    }

    const rawList = typeof json['get_clientlist'] === 'string'
      ? json['get_clientlist']
      : '';

    const clients = parseClientList(rawList);
    console.log(`[AsusWrtProvider] getClientList(): ${clients.length} client(s) found.`);
    return clients;
  }

  // -------------------------------------------------------------------------
  // Write — internet access
  // -------------------------------------------------------------------------

  /**
   * Enable or disable internet access for a client by MAC address.
   *
   * POST /applyapp.cgi
   *   Content-Type: application/x-www-form-urlencoded
   *   Cookie: asus_token=<token>
   *   Body: hook=set_client_state(<mac>,<enabled>,<cut_mac>,<group>)
   *
   * Stock firmware set_client_state argument format (verify during spike):
   *   - mac:     uppercase colon-separated MAC
   *   - enabled: "1" = internet ON, "0" = internet OFF
   *   - cut_mac: same as mac (some firmware variants require this)
   *   - group:   "" (empty = no group association)
   *
   * The response body on success is typically:
   *   { [hook_name]: "" } or a status field.
   *
   * Block persistence: UNVERIFIED — see docs/phase1-feasibility-report.md §3.
   *
   * @param mac     Uppercase colon-separated MAC, e.g. "AA:BB:CC:DD:EE:FF".
   * @param enabled true = grant internet access, false = block.
   * @throws Error if not authenticated or request fails at transport level.
   */
  async setInternetAccess(mac: string, enabled: boolean): Promise<AccessResult> {
    const { host } = await getRouterCredentials();

    if (!host) {
      throw new Error(
        'AsusWrtProvider.setInternetAccess(): ROUTER_HOST not set.'
      );
    }

    const enabledFlag = enabled ? '1' : '0';
    // Hook format: set_client_state(<mac>,<enabled>,<cut_mac>,<group>)
    // Verify exact arity and argument order against live firmware during the spike.
    const hook = `set_client_state(${mac},${enabledFlag},${mac},)`;

    const url = `http://${host}/applyapp.cgi`;
    const body = new URLSearchParams({ hook });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.authHeaders(host),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (err) {
      return {
        success: false,
        message: `Network error calling setInternetAccess: ${String(err)}`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP ${response.status} from ${url} for set_client_state`,
      };
    }

    const action = enabled ? 'ENABLED' : 'DISABLED';
    console.log(`[AsusWrtProvider] setInternetAccess(${mac}, ${enabled}): ${action}`);

    return {
      success: true,
      message: `Internet access ${action} for ${mac}`,
    };
  }

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  /**
   * Return the capability map for stock ASUS firmware.
   * All v1 capabilities are supported.
   */
  capabilities(): CapabilityMap {
    return {
      getClientList: true,
      setInternetAccess: true,
      reboot: true,
    };
  }

  // -------------------------------------------------------------------------
  // Reboot
  // -------------------------------------------------------------------------

  /**
   * Trigger a router reboot.
   *
   * POST /applyapp.cgi
   *   Body: hook=reboot
   *
   * ONLY call during a supervised spike session — all connections will drop.
   * Used to verify that block state persists across a reboot (NVRAM-backed).
   *
   * @throws Error if not authenticated or the reboot request fails.
   */
  async reboot(): Promise<void> {
    const { host } = await getRouterCredentials();

    if (!host) {
      throw new Error('AsusWrtProvider.reboot(): ROUTER_HOST not set.');
    }

    const url = `http://${host}/applyapp.cgi`;
    const body = new URLSearchParams({ hook: 'reboot' });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.authHeaders(host),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `AsusWrtProvider.reboot(): HTTP ${response.status}. Router may still reboot — wait 60s.`
      );
    }

    console.log('[AsusWrtProvider] reboot(): Reboot command sent. Wait ~60s for the router to come back online.');
  }
}
