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
// Explicit .ts extensions so the plain-Node sync worker (scripts/worker.mjs)
// can import this module directly under `node --conditions=react-server`, which
// strips TS types but does NOT resolve extensionless relative specifiers.
// allowImportingTsExtensions (tsconfig) keeps tsc/Next happy with these.
import { getRouterCredentials } from '../secrets.ts';
import { parseAsusClientList } from './parseAsusClientList.ts';
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

  /**
   * Lazily ensure a valid session token before an authed request.
   *
   * Callers (the block/unblock API routes, sync) construct a fresh provider per
   * request and do NOT call login() themselves. Without this, authHeaders()
   * throws / the request silently fails — exactly why a UI "block" recorded
   * is_blocked=1 but router_synced=0 and never cut the device off. Re-logs in
   * once the cached token has aged past its TTL.
   *
   * @throws Error if login() fails (e.g. missing credentials / bad password).
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.isAuthenticated()) {
      await this.login();
    }
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

    await this.ensureAuthenticated();

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
    const online = clients.filter((c) => c.connected).length;
    console.log(`[AsusWrtProvider] getClientList(): ${clients.length} client(s) (${online} online).`);
    return clients;
  }

  // -------------------------------------------------------------------------
  // Write — internet access (Parental Control / Network Services Filter)
  // -------------------------------------------------------------------------
  //
  // `set_client_state(...)` is NOT a real block hook — the router returns 200
  // and does nothing, which is why a "Blocked" device kept its internet. Real
  // blocking drives the parental-control MULTIFILTER subsystem: four
  // index-aligned, `>`-joined nvram lists, mutated via a read-modify-write and
  // committed with `action_mode=apply` + `rc_service=restart_firewall` (the
  // commit/apply step that was missing). ENABLE=2 = block 24/7; daytime `<` is
  // a bare schedule. Existing entries (e.g. GUI time-schedules) are preserved.

  // The four MULTIFILTER lists, in a fixed order. Read together they must all
  // have the same length (one entry per device) or the table is corrupt.
  private static readonly MF_VARS = [
    'MULTIFILTER_MAC',
    'MULTIFILTER_ENABLE',
    'MULTIFILTER_DEVICENAME',
    'MULTIFILTER_MACFILTER_DAYTIME_V2',
  ] as const;

  /** Decode the router's HTML numeric entities (`&#62`→`>`, `&#60`→`<`). */
  private decodeMfEntities(s: string): string {
    return s.replace(/&#62/g, '>').replace(/&#60/g, '<');
  }

  /** Split a `>`-joined MULTIFILTER list; an empty string is the empty list. */
  private splitMfList(raw: string): string[] {
    return raw === '' ? [] : raw.split('>');
  }

  /**
   * Read one nvram value via appGet.cgi (decoded).
   * @throws Error on transport failure or a rejected token.
   */
  private async nvramGet(name: string): Promise<string> {
    const { host } = await getRouterCredentials();
    const res = await fetch(`http://${host}/appGet.cgi?hook=nvram_get(${name})`, {
      method: 'GET',
      headers: this.authHeaders(host),
    });
    if (!res.ok) {
      throw new Error(`AsusWrtProvider.nvramGet(${name}): HTTP ${res.status}`);
    }
    const text = await res.text();
    if (text.includes('Main_Login.asp')) {
      this.token = null;
      this.tokenAcquiredAt = null;
      throw new Error(
        `AsusWrtProvider.nvramGet(${name}): login redirect — token rejected.`
      );
    }
    const json = JSON.parse(text) as Record<string, string>;
    return this.decodeMfEntities(json[name] ?? '');
  }

  /** Read all four parental-control lists, split and ready to mutate. */
  private async readMultifilter(): Promise<{
    macs: string[];
    enables: string[];
    names: string[];
    daytimes: string[];
  }> {
    // One request per var: the chained `nvram_get(a);nvram_get(b)` form only
    // returns the first value on this firmware.
    const [mac, enable, name, daytime] = await Promise.all(
      AsusWrtProvider.MF_VARS.map((v) => this.nvramGet(v)),
    );
    return {
      macs: this.splitMfList(mac),
      enables: this.splitMfList(enable),
      names: this.splitMfList(name),
      daytimes: this.splitMfList(daytime),
    };
  }

  /**
   * Block or unblock a client's internet via the parental-control filter.
   *
   * BLOCK (enabled=false): append the MAC with ENABLE=2 (24/7) if absent, or
   * flip its existing entry to ENABLE=2. UNBLOCK (enabled=true): remove our
   * entry entirely. Either way the full, preserved lists are POSTed back with
   * action_mode=apply + rc_service=restart_firewall.
   *
   * @param mac     Colon-separated MAC (case-insensitive).
   * @param enabled true = grant internet (remove rule); false = block 24/7.
   */
  /** Strict colon-separated MAC address pattern (e.g. AA:BB:CC:DD:EE:FF). */
  private static readonly MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

  async setInternetAccess(mac: string, enabled: boolean): Promise<AccessResult> {
    // Validate MAC format before it reaches the `>`-joined MULTIFILTER body.
    // A malformed value containing `>` could corrupt the entire nvram list.
    if (!AsusWrtProvider.MAC_RE.test(mac)) {
      return {
        success: false,
        message: `setInternetAccess(): invalid MAC address format: "${mac}". ` +
          'Expected XX:XX:XX:XX:XX:XX (hex pairs separated by colons).',
      };
    }

    const { host } = await getRouterCredentials();
    if (!host) {
      throw new Error(
        'AsusWrtProvider.setInternetAccess(): ROUTER_HOST not set.'
      );
    }

    // Fresh provider has no token; log in lazily so callers don't have to.
    try {
      await this.ensureAuthenticated();
    } catch (err) {
      return { success: false, message: `Authentication failed: ${String(err)}` };
    }

    const targetMac = mac.toUpperCase();

    let lists;
    try {
      lists = await this.readMultifilter();
    } catch (err) {
      return {
        success: false,
        message: `Failed to read parental-control rules: ${String(err)}`,
      };
    }
    const { macs, enables, names, daytimes } = lists;

    // Refuse to write misaligned lists — that corrupts the whole table.
    const len = macs.length;
    if (
      enables.length !== len ||
      names.length !== len ||
      daytimes.length !== len
    ) {
      return {
        success: false,
        message:
          `MULTIFILTER lists misaligned (mac=${len}, enable=${enables.length}, ` +
          `name=${names.length}, daytime=${daytimes.length}); refusing to write.`,
      };
    }

    const idx = macs.findIndex((m) => m.toUpperCase() === targetMac);

    if (!enabled) {
      // BLOCK 24/7
      if (idx >= 0) {
        enables[idx] = '2';
      } else {
        macs.push(targetMac);
        enables.push('2');
        names.push('DarylWeb block');
        daytimes.push('<');
      }
    } else {
      // UNBLOCK — remove our entry, preserving all others
      if (idx < 0) {
        return {
          success: true,
          message: `No parental-control rule for ${targetMac}; already unblocked.`,
        };
      }
      macs.splice(idx, 1);
      enables.splice(idx, 1);
      names.splice(idx, 1);
      daytimes.splice(idx, 1);
    }

    const body = new URLSearchParams({
      action_mode: 'apply',
      rc_service: 'restart_firewall',
      MULTIFILTER_ALL: '1',
      MULTIFILTER_MAC: macs.join('>'),
      MULTIFILTER_ENABLE: enables.join('>'),
      MULTIFILTER_DEVICENAME: names.join('>'),
      MULTIFILTER_MACFILTER_DAYTIME_V2: daytimes.join('>'),
    });

    const url = `http://${host}/applyapp.cgi`;
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
        message: `Network error applying parental-control rule: ${String(err)}`,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        message: `HTTP ${response.status} from ${url} applying parental-control rule.`,
      };
    }

    const action = enabled ? 'UNBLOCKED' : 'BLOCKED';
    console.log(
      `[AsusWrtProvider] setInternetAccess(${targetMac}, ${enabled}): ${action} ` +
        `via MULTIFILTER (restart_firewall).`,
    );
    return {
      success: true,
      message: `Internet access ${action} for ${targetMac} (parental-control, restart_firewall).`,
    };
  }

  /**
   * Best-effort read of the current per-MAC block state from the router.
   *
   * Best-effort: stock ASUS firmware does not expose a reliable per-MAC block
   * read via the CGI API. Returning null signals "unknown" so drift reconcile
   * re-applies the intended state. The Phase 8 live test probes whether the
   * firmware can report this at all (e.g. via a clientlist field); wire it here
   * if a reliable signal is found.
   */
  async getBlockState(mac: string): Promise<boolean | null> {
    // Read the parental-control table and report whether this MAC has a 24/7
    // block (ENABLE=2). A time-schedule entry (ENABLE=1) or absence is "not
    // hard-blocked" → false. Any failure returns null ("unknown") so drift
    // reconcile re-applies rather than assuming a state.
    try {
      await this.ensureAuthenticated();
      const { macs, enables } = await this.readMultifilter();
      const idx = macs.findIndex((m) => m.toUpperCase() === mac.toUpperCase());
      if (idx < 0) return false;
      return enables[idx] === '2';
    } catch {
      return null;
    }
  }

  /**
   * Bulk read of every MAC the router is currently hard-blocking (ENABLE=2).
   *
   * One readMultifilter (4 nvram reads) instead of a getBlockState() per device,
   * so a full reconcile of N devices costs a constant 4 requests rather than 4N.
   * Used by the manual "Refresh" pull-reconcile to mirror live router truth into
   * app_block_state. Throws on transport failure so callers can distinguish a
   * read error from "nothing blocked".
   */
  async getBlockedMacs(): Promise<string[]> {
    await this.ensureAuthenticated();
    const { macs, enables } = await this.readMultifilter();
    const blocked: string[] = [];
    for (let i = 0; i < macs.length; i++) {
      if (enables[i] === '2') blocked.push(macs[i].toUpperCase());
    }
    return blocked;
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
