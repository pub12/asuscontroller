# Google-only sign-in — design

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation
**Scope:** localhost dev only, login-only (no extended Google API scopes)

## Goal

Replace the email/password login on NetWarden with **Google-only** sign-in. Today
the app is email-only: `next-auth` is intentionally uninstalled and replaced with
no-op stubs (`stubs/next-auth-*.js`, aliased in `next.config.js`). The visible
"Continue with Google" button therefore calls a stub `signIn()` that never
redirects, hanging forever at "Signing in…". This change makes Google sign-in real
and removes the email/password path.

## End-to-end flow (target)

1. User clicks "Continue with Google" → real `signIn("google")` (from
   `next-auth/react`) → POST `/api/auth/signin/google` → browser redirects to the
   Google consent screen.
2. Google redirects back to `/api/auth/callback/google` (next-auth's own callback).
   next-auth runs the `signIn` callback, which calls `handle_google_oauth_login`
   to find/link the hazo user by email, then the `redirect` callback forwards to
   `/api/hazo_auth/oauth/google/callback`.
3. `/api/hazo_auth/oauth/google/callback` (hazo_auth route) sets the **hazo_auth
   session cookie** and redirects into the app. `src/middleware.ts` validates the
   cookie on protected routes (`/`, `/explore`, `/schedules`, `/analytics`,
   `/admin`, `/settings`).

## Changes

### 1. Dependency
- Add `next-auth@^4.24` to `package.json` dependencies and install.

### 2. Remove the stubs
- In `next.config.js`, delete the `next-auth*` entries from BOTH the
  `turbopack.resolveAlias` block and the `webpack()` alias block. Keep the
  `hazo_debug` stub. The `stubs/next-auth-*.js` files become unused (leave or
  delete; non-functional either way).

### 3. Secrets — `.env.local`
- `NEXTAUTH_SECRET=<generated 32-byte base64>` — required by next-auth v4.
- `NEXTAUTH_URL=http://localhost:3051` — must match the actual dev port. The dev
  server runs on 3051 (the launcher default is 3400; `PORT` overrides it). Wrong
  port here → broken callback URLs.

### 4. OAuth config — `config/hazo_auth_config.ini` `[hazo_auth__oauth]`
```ini
enable_google = true
enable_email_password = false
enable_facebook_oauth = false
```
This replaces the temporary `enable_google = false` set while diagnosing the hang.
With `enable_email_password = false`, the login layout renders only the Google
button (no email form, no divider).

### 5. Superadmin / lockout fix
Google-only means the only way in is a Google account. The seeded superadmin is
`admin@netwarden.local` — not a real Google account — so a fresh Google sign-in
would create a NON-admin user and lock the operator out of `/admin`, `/settings`,
etc.

Fix:
- Set `SUPERADMIN_EMAIL=pubudu79@gmail.com` in `.env.local`.
- Re-run the seed (`scripts/seed.mjs`, invoked automatically by `predev` on
  `npm run dev`). It upserts a verified (`email_verified = 1`, `status = ACTIVE`)
  superadmin user with that email and grants the `netwarden:nw:superadmin`
  permission via the role/scope chain.
- First Google sign-in with `pubudu79@gmail.com`: `handle_google_oauth_login`
  finds the existing user by email and links the Google `sub` (account linking
  proceeds for verified accounts; `auto_link_unverified_accounts` default `true`
  also covers the unverified case). The operator logs in AS the seeded superadmin.

## Manual step (operator, outside the codebase)

In Google Cloud Console → the existing OAuth client (ID already in `.env.local`):
- **Authorized redirect URI:** `http://localhost:3051/api/auth/callback/google`
- **Authorized JavaScript origin:** `http://localhost:3051`

Without the redirect URI, Google returns `redirect_uri_mismatch`.

## Risks

- **next-auth v4 on Next 16 / React 19.** The hazo_auth `/api/auth/[...nextauth]`
  wrapper is written for this (it awaits Next 16's Promise `params`), so it is
  expected to work, but the combination is the one item that can only be fully
  de-risked by running the flow. Verification covers it.
- **Stale config cache.** `HazoConfig` instances are cached per process; the dev
  server must be restarted to pick up the ini change.

## Verification

1. `npm run dev` (PORT=3051) — seed runs, server starts clean.
2. `/api/auth/providers` and `/api/auth/csrf` return 200 (were 500 under the stub).
3. Visit `/login` → only the Google button shows (no email form).
4. Click it → redirected to Google → consent → back to app, landed authenticated
   (hazo_auth cookie set).
5. `/admin` and `/settings` load (superadmin permission confirmed).

## OAuth token-storage keys (required, discovered during implementation)

hazo_auth's Google provider requests `access_type=offline`, so Google always
returns a refresh token. Its sign-in callback then compares granted scopes
against a short-name `BASE_SCOPES` list (`openid`/`email`/`profile`) — but Google
returns canonical scope URLs (`.../userinfo.email`, `.../userinfo.profile`), so
the "extra scopes?" check is always true and the callback unconditionally tries
to encrypt-and-persist the refresh token. Without encryption keys this throws
`GoogleTokenStorageUnconfigured` and sign-in fails (redirect to
`/login?error=GoogleTokenStorageUnconfigured`).

Fix: set the OAuth token-storage keys in `.env.local` (AES-256-GCM, base64 of 32
bytes), mirroring the existing `HAZO_FIELD_KEY` pattern:
```
HAZO_AUTH_OAUTH_KEY_CURRENT=v1
HAZO_AUTH_OAUTH_KEY_V1=<base64 32 bytes>
```
The encrypted refresh token is stored in `hazo_google_oauth_tokens`. We don't use
it (login-only), but it is unavoidable given hazo_auth's design.

## Out of scope (YAGNI)

- Extended Google scopes (Drive/Gmail/Calendar) — we request only
  `openid email profile`. (Refresh-token storage is NOT optional; see above.)
- Production / Cloudflare-tunnel redirect URIs and `NEXTAUTH_URL`.
- Keeping email/password as a fallback login method.
