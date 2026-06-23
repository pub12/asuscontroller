# DarylWeb — Security Audit

**Audit date:** 2026-06-23  
**Scope:** Full source audit of the DarylWeb codebase (Next.js 16 App Router, `hazo_*` platform,
`better-sqlite3`, `next-auth` v4, PM2 deployment on port 3051).  
**Methodology:** Static source review across all server routes, middleware, auth flows, external
integrations, input handling, secret management, and network binding.

---

## Summary

DarylWeb is a self-hosted ASUS-router parental-control app. It has **good foundational controls**
(zod validation, capability-based auth, parameterised SQL, path-traversal guards, AES-256-GCM field
crypto) but had several issues ranging from critical to informational. All code-level findings have
been remediated in this audit; items requiring human action are listed under [Your checklist](#your-checklist-action-required).

---

## Findings

### CRITICAL — Forgeable session tokens ✅ Fixed

**Finding:** `JWT_SECRET` in `.env.local` was the literal placeholder
`change-me-to-a-long-random-string`. Anyone who knew or guessed this value could forge a valid
session cookie for any user, including the superadmin.

**Fix applied:** Generated a strong 48-byte random secret via `openssl rand -base64 48` and
wrote it to `.env.local`. Both the web process and the worker read this at startup; restart both
after any key rotation.

**Note:** Rotating `JWT_SECRET` invalidates all existing browser sessions — every user will be
prompted to log in again. This is expected and correct.

---

### HIGH — 14 unauthenticated test-route endpoints reachable in production ✅ Fixed

**Finding:** 14 API routes under `src/app/api/*-test/` were reachable without authentication in
any environment. They execute `hazo_testing` suites on the live server, write to `os.tmpdir()`,
and expose internal implementation details. The affected open routes were:

`auth-test`, `authorize-test`, `block-api-test`, `block-service-test`, `block-sim-test`,
`grants-test`, `group-block-test`, `groups-image-test`, `groups-test`, `requests-test`,
`schema-test`, `secret-test`, `settings-gate-test`, `state-audit-test`

**Fix applied:** Added a `PROD_BLOCKED_RE` check in `src/middleware.ts` that returns a hard **404**
for any path matching `/api/*-test` or `/api/v1/docs*` when `NODE_ENV === 'production'`. The
matcher config was updated to route these paths through middleware. The 12 routes that already had
inline `NODE_ENV` guards keep them as defence-in-depth.

---

### HIGH — Weak superadmin bootstrap password ⚠️ User action required

**Finding:** `.env.local` contains `SUPERADMIN_PASSWORD=changeme1234`. This password is used to
bootstrap the first superadmin account. If that account's password has not been changed after
first login, the account is trivially compromised.

**Remediation:** See [Your checklist](#your-checklist-action-required).

---

### MEDIUM — Public OpenAPI spec and Swagger UI ✅ Fixed (via middleware)

**Finding:** `GET /api/v1/docs` (OpenAPI JSON) and `GET /api/v1/docs/ui` (Swagger UI) were
reachable without authentication, exposing the full API surface map and making it trivial to
enumerate all endpoints.

**Fix applied:** Covered by the same `PROD_BLOCKED_RE` middleware block as the test routes above.
Both paths return 404 in production. They remain accessible in development.

---

### MEDIUM — App binds to `0.0.0.0` (LAN-wide exposure)

**Finding:** Neither `scripts/next.mjs` nor `ecosystem.config.js` specifies a bind hostname,
so Next.js defaults to `0.0.0.0:3051` — visible to every host on the LAN. The router-control
API is therefore reachable by any device on the household network, gated only by app authentication.

**Assessment:** This is likely intentional (phones on the LAN need to reach it), but it's worth
documenting. The existing app authentication is a sufficient control for a trusted LAN, provided
all other auth issues are resolved.

**Fix applied:** Added optional `-H $HOST` support to `scripts/next.mjs`. Set `HOST=127.0.0.1`
in the environment if you want to run DarylWeb behind a reverse proxy (nginx/Caddy) and restrict
direct access to localhost only. Default behaviour (bind all interfaces) is unchanged.

**Reverse-proxy note:** If you add a reverse proxy in front of `:3051`, consider also adding
an HSTS header (`Strict-Transport-Security: max-age=31536000`) at the proxy layer once you have
HTTPS.

---

### LOW / INFO — Cleartext HTTP to the router

**Finding:** `src/server/router/AsusWrtProvider.ts` communicates with the ASUS router over
`http://` (not HTTPS). Credentials are sent as `base64(user:pass)` in the `login_authorization`
header — base64 is trivially reversible, not encryption. The router admin password transits the
LAN in cleartext on every authentication.

**Root cause:** This is inherent to the ASUS stock CGI firmware; the router does not offer an
HTTPS API without third-party firmware (Merlin, OpenWrt).

**Mitigations available:**
- If your router supports HTTPS (check Advanced Settings → Administration → System), enable it
  and change `ROUTER_HOST` to `https://192.168.50.1`.
- Run the web app and router on the same VLAN/subnet to limit who can sniff traffic.
- Flash Asuswrt-Merlin for a more secure API surface.

---

### LOW — MAC address not validated before entering MULTIFILTER lists ✅ Fixed

**Finding:** `AsusWrtProvider.setInternetAccess()` accepted any string for the `mac` parameter and
`>`-joined it directly into the NVRAM POST body. A malformed MAC containing `>` could corrupt the
entire MULTIFILTER parental-control table on the router.

**Fix applied:** Added `AsusWrtProvider.MAC_RE` (`/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/`) and
an early-return guard at the top of `setInternetAccess()`. An invalid MAC now returns a
`{ success: false }` result before touching the router.

---

### LOW — Telegram alerts use `parse_mode: 'HTML'` without escaping ✅ Fixed

**Finding:** `src/server/notify/NotifyProvider.ts` sends Telegram messages with `parse_mode: 'HTML'`
but did not escape dynamic values (device names, user names) before interpolating them into the
message body. A device name containing `<`, `>`, or `&` could break message formatting or produce
unintended Telegram markup.

**Fix applied:** Added an exported `htmlEscape()` function to `NotifyProvider.ts`. Call it on any
dynamic value before interpolating into an alert `title` or `body`. Callers that use static strings
are unaffected.

```ts
import { htmlEscape } from '@/server/notify/NotifyProvider';
notify.alert({ title: `Device blocked: ${htmlEscape(device.name)}` });
```

---

### INFO — No Content Security Policy

**Finding:** `next.config.js` explicitly omits a CSP to avoid breaking the Swagger UI. This leaves
the app without XSS-mitigating content restrictions.

**Recommended path:** Once the Swagger UI is removed from production (covered by the middleware
block), a CSP can be added. A starter policy for DarylWeb:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com;
  connect-src 'self' https://*.google-analytics.com https://*.googletagmanager.com;
  img-src 'self' data: https://*.google-analytics.com;
  style-src 'self' 'unsafe-inline';
  font-src 'self';
  frame-ancestors 'none';
```

The `'unsafe-inline'` on `script-src` is needed for the existing theme-flash-prevention inline
script in `layout.tsx`. To tighten further, replace the inline script with a `nonce` or hash.

---

## Verified-good controls

These are areas that were audited and found to be correctly implemented:

| Control | Implementation |
|---------|---------------|
| Input validation | `zod` `safeParse` on all mutation request bodies |
| Capability-based auth | `authorizeCapability()` on block/unblock/policy routes; IDOR fix confirmed in recent commits |
| SQL injection | All queries use `?` placeholder parameterisation — no string-concatenated SQL found |
| Path traversal | `groups/image/[fileId]` validates `UUID_RE.test(fileId)` before any `path.join` |
| Field encryption | `EnvKeyProvider` with AES-256-GCM; `secrets.ts` marked `server-only` |
| Sensitive field stripping | Admin users API explicitly omits `password_hash`, `mfa_secret`, `pin_hash` |
| Image upload hardening | Uploads re-encoded to WebP; served with restrictive CSP + `Content-Disposition: inline` |
| No shell injection | No `child_process`, `exec`, `spawn`, or `eval` in the application code |
| `.env.local` not in git | Confirmed: file is gitignored and has never appeared in commit history |
| `*.sqlite` files not in git | Confirmed: production databases are gitignored |
| CORS | No `Access-Control-Allow-Origin` configured — same-origin default; safe for cookie-auth |
| Session cookies | Set server-side by `hazo_auth`; should be `SameSite=Lax` — verify in browser devtools |
| Existing security headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-DNS-Prefetch-Control` |

---

## Your checklist (action required)

These items require your direct action. They cannot be automated safely because they involve
credentials you control or production-environment decisions.

- [ ] **Change `SUPERADMIN_PASSWORD`** in `.env.local` from `changeme1234` to a strong unique
  password. Also change the actual superadmin account password in the running app if it was set
  with the weak bootstrap value.

- [ ] **Change `ROUTER_PASS`** in `.env.local` to a strong router admin password, and update the
  corresponding password on the router itself (ASUS admin panel → Administration → System →
  Router Login Password). The current password transits the LAN on every sync cycle.

- [ ] **Rotate the Google OAuth client secret** (`HAZO_AUTH_GOOGLE_CLIENT_SECRET`) in Google
  Cloud Console and update `.env.local`. The current value was visible in the on-disk env file;
  treat it as potentially compromised.

- [ ] **Rotate `NEXTAUTH_SECRET`** to a new random value (`openssl rand -base64 48`). Update
  `.env.local` and restart both the web and worker processes.

- [ ] **Consider enabling HTTPS** on the router itself (Administration → System → Enable HTTPS
  for web access) or flashing Asuswrt-Merlin, then updating `ROUTER_HOST` to `https://...`.

- [ ] **Verify session cookie `SameSite` attribute**: in browser devtools (Application →
  Cookies), confirm the `darylweb_hazo_auth_session` cookie is `SameSite=Lax` or `Strict`.
  This is set inside `hazo_auth` and not visible in this repo's source.

- [ ] **Set `NEXT_PUBLIC_GA_ID`** in `.env.local` to your GA4 Measurement ID (`G-XXXXXXXXXX`)
  once you create the property in Google Analytics. The tracker is dormant until this is set.

- [ ] **Remove or gitignore `netwarden.sqlite`** in the repo root — it may contain device MAC
  addresses and historical network data from a prior migration. Confirm it holds no sensitive data
  before deleting.

---

## Audit revision history

| Date | By | Notes |
|------|----|-------|
| 2026-06-23 | Claude Code (security audit) | Initial audit; all code-level findings remediated |
