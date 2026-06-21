/**
 * src/server/router/RouterProvider.ts — Server-only interface for router control.
 *
 * Captures the v1 control surface for stock ASUS firmware routers:
 *   - Authentication / token lifecycle
 *   - Reading connected clients (app_devices sync source)
 *   - Setting internet access per client MAC (v1 block = internet on/off)
 *
 * v1 scope: internet on/off only.
 * Per-domain blocking is NOT part of v1 — do not add it here.
 *
 * Stock ASUS endpoints used by implementors:
 *   POST /login.cgi          — exchange user/pass for asus_token cookie
 *   GET  /appGet.cgi         — read hook (hook=get_clientlist, etc.)
 *   POST /applyapp.cgi       — write hook (set_client_state, etc.)
 *
 * DO NOT import this file from any Client Component, shared lib, or
 * auto-executing path. Server-only.
 */
import 'server-only';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * A single network client as reported by the router.
 * Populated from get_clientlist (stock ASUS firmware).
 */
export interface RouterClient {
  /** MAC address — primary stable identifier, uppercase colon-separated (e.g. "AA:BB:CC:DD:EE:FF"). */
  mac: string;
  /** Current IP address assigned by DHCP, or empty string if unknown. */
  ip: string;
  /** Hostname reported by the client, or empty string. */
  name: string;
  /** Whether the client is currently connected to the router. */
  connected: boolean;
  /** Wi-Fi band the client is on ("2G" | "5G" | "6G" | "wired" | ""), if reported. */
  band: string;
  /** Vendor/OUI string, if the router exposes it (may be empty). */
  vendor: string;
}

/**
 * Outcome of a setInternetAccess call.
 */
export interface AccessResult {
  /** Whether the operation succeeded at the router level. */
  success: boolean;
  /** Human-readable status message from the router, or a local error description. */
  message: string;
}

/**
 * Internet access state — mirrors the router's per-MAC block concept.
 * v1 only: on/off at the internet level (applyapp.cgi set_client_state).
 */
export type InternetAccess = 'enabled' | 'disabled';

/**
 * Describes whether a capability is supported by this provider/firmware.
 * Used for capability markers so callers can gracefully degrade.
 */
export interface CapabilityMap {
  /** Provider can read the connected client list. */
  getClientList: boolean;
  /** Provider can toggle per-client internet access (v1 block). */
  setInternetAccess: boolean;
  /** Provider can trigger a router reboot. */
  reboot: boolean;
}

// ---------------------------------------------------------------------------
// RouterProvider interface
// ---------------------------------------------------------------------------

/**
 * RouterProvider — the server-side contract for communicating with the home
 * router.  All methods are async; they communicate over HTTP with the router
 * and must only be called from server-side code in a supervised session.
 *
 * Implementations are responsible for managing their own auth state
 * (token acquisition and refresh) internally — callers do not manage tokens.
 */
export interface RouterProvider {
  // -------------------------------------------------------------------------
  // Auth / token lifecycle
  // -------------------------------------------------------------------------

  /**
   * Authenticate with the router and acquire (or refresh) a session token.
   *
   * Stock firmware endpoint: POST /login.cgi
   *   Body (form-encoded): login_authorization=<base64(user:pass)>
   *   Success: sets `asus_token` cookie; response body contains the token value.
   *
   * Implementations SHOULD cache the token internally and re-use it until it
   * expires (typically ~30 minutes on stock ASUS firmware).
   *
   * @throws Error if credentials are missing or the login request fails.
   */
  login(): Promise<void>;

  /**
   * Whether the current token is believed to be valid (non-expired).
   * Providers that do not track expiry should return `true` after a successful
   * login() until an authenticated call returns 401/403.
   */
  isAuthenticated(): boolean;

  // -------------------------------------------------------------------------
  // Read — client list
  // -------------------------------------------------------------------------

  /**
   * Fetch the list of all clients the router knows about (connected + recent).
   *
   * Stock firmware endpoint: GET /appGet.cgi?hook=get_clientlist()
   *   Response: JSON { get_clientlist: "<raw-nvram-string>" }
   *   The raw string is a semicolon-delimited list of records, each in the
   *   format: <mac><ip><name><connected><band><vendor> — exact delimiter
   *   varies by firmware version; verify during the supervised spike.
   *
   * Callers should NOT cache this — the spike needs a fresh read on each call.
   *
   * @throws Error if not authenticated or the request fails.
   */
  getClientList(): Promise<RouterClient[]>;

  // -------------------------------------------------------------------------
  // Write — internet access
  // -------------------------------------------------------------------------

  /**
   * Enable or disable internet access for a single client by MAC address.
   *
   * v1 block mechanism: internet on/off only (not per-domain, not bandwidth).
   * The router enforces this via an internal block list stored in NVRAM.
   *
   * Stock firmware endpoint: POST /applyapp.cgi
   *   Content-Type: application/x-www-form-urlencoded
   *   Body: hook=set_client_state(<mac>,<enabled>)
   *   where <enabled> is "1" (access enabled) or "0" (access disabled).
   *
   * Block persistence across reboot: UNVERIFIED — to be confirmed during the
   * supervised spike session (see docs/phase1-feasibility-report.md §3).
   *
   * @param mac     Uppercase colon-separated MAC, e.g. "AA:BB:CC:DD:EE:FF".
   * @param enabled true = grant internet access, false = block internet access.
   * @returns       AccessResult indicating success/failure + router message.
   * @throws        Error if not authenticated or the request fails at transport level.
   */
  setInternetAccess(mac: string, enabled: boolean): Promise<AccessResult>;

  /**
   * Best-effort read of the router's current per-MAC internet-block state.
   *
   * @returns true  = router reports this MAC is blocked (internet OFF),
   *          false = router reports this MAC is NOT blocked,
   *          null  = unknown / firmware does not report it reliably.
   *
   * Optional: providers that cannot determine block state omit it or return null.
   * Drift reconcile treats `null` (unknown) as drift and re-applies the intended state.
   */
  getBlockState?(mac: string): Promise<boolean | null>;

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  /**
   * Return the capability map for this provider/firmware combination.
   * Callers use this to decide whether to show block controls in the UI.
   *
   * For stock ASUS firmware: { getClientList: true, setInternetAccess: true, reboot: true }.
   */
  capabilities(): CapabilityMap;

  // -------------------------------------------------------------------------
  // Optional — reboot
  // -------------------------------------------------------------------------

  /**
   * Trigger a router reboot.
   *
   * Stock firmware endpoint: POST /applyapp.cgi
   *   Body: hook=reboot
   *
   * Used during the supervised spike to test reboot-survival of block state.
   * ONLY call this during a supervised session — it will drop all connections.
   *
   * @throws Error if not authenticated, capabilities().reboot is false, or the request fails.
   */
  reboot(): Promise<void>;
}
