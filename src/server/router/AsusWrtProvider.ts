/**
 * src/server/router/AsusWrtProvider.ts — RouterProvider for stock ASUS firmware
 * (ASUSWRT) over the undocumented CGI API. Verified against live ZenWiFi
 * hardware on 2026-06.
 *
 * Stock firmware CGI endpoints:
 *   POST /login.cgi          — exchange credentials for asus_token
 *   GET  /appGet.cgi         — read hooks (get_clientlist, etc.)
 *   POST /applyapp.cgi       — write hooks (set_client_state, reboot, etc.)
 *
 * IMPORTANT — User-Agent binding: stock firmware ties the issued asus_token to
 * the User-Agent that logged in. Authenticated requests MUST reuse the exact
 * same User-Agent or the router silently returns an HTML redirect to
 * Main_Login.asp instead of data. Hence the single ASUS_USER_AGENT constant
 * used for both login and every authenticated call.
 *
 * Wired into the app via getRouterProvider() when ROUTER_PROVIDER=asus
 * (src/server/router/index.ts) and driven by runDeviceSync.
 */
import 'server-only';
import { getRouterCredentials } from '../secrets';
import { parseAsusClientList } from './parseAsusClientList';
import type {
  RouterProvider,
  RouterClient,
  AccessResult,
  CapabilityMap,
} from './RouterProvider';

// ---------------------------------------------------------------------------
// Internal helpers / constants
// ---------------------------------------------------------------------------

/**
 * Default token TTL assumed for stock ASUS firmware.
 * The router does not report an explicit expiry in the login response; ~30 min
 * is the observed idle timeout. login() is cheap, so callers re-auth on demand.
 */
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * User-Agent used for login AND every authenticated request. Must be identical
 * across the session — see the token-binding note in the file header. This is
 * the ASUS Android app's UA, which the firmware accepts for the CGI API.
 */
const ASUS_USER_AGENT = 'asusrouter-Android-DUTUtil-1.0.0.245';

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
        'User-Agent': ASUS_USER_AGENT,
        Referer: `http://${host}/Main_Login.asp`,
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
      'User-Agent': ASUS_USER_AGENT,
      Referer: `http://${host}/index.asp`,
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
   * Response JSON (verified shape):
   *   { "get_clientlist": { "<MAC>": { name, nickName, ip, vendor,
   *                                    isOnline, isWL, ... }, ..., "maclist": [...] } }
   *
   * If the token is rejected (e.g. wrong User-Agent / expired) the router
   * returns HTTP 200 with an HTML body redirecting to Main_Login.asp rather
   * than JSON — we detect that and surface a clear error.
   *
   * Parsing lives in parseAsusClientList() (pure, shared with the CLI sync).
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

    const text = await response.text();

    // Silent-auth-failure guard: the firmware answers 200 + an HTML login
    // redirect when the session is not accepted. Treat the token as stale.
    if (text.includes('Main_Login.asp')) {
      this.token = null;
      this.tokenAcquiredAt = null;
      throw new Error(
        'AsusWrtProvider.getClientList(): router returned a login redirect — ' +
          'token rejected (expired or User-Agent mismatch). Call login() again.'
      );
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(
        'AsusWrtProvider.getClientList(): could not parse response as JSON.'
      );
    }

    const clients = parseAsusClientList(json);
    console.log(`[AsusWrtProvider] getClientList(): ${clients.length} online client(s) found.`);
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
