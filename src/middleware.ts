import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validate_session_cookie } from 'hazo_auth/server/middleware';

/**
 * Mirror hazo_get_auth's fallback: when the JWT session cookie is absent or
 * invalid, hazo_auth still treats a request as authenticated if the simple
 * `user_id` + `user_email` cookies are present (set by every login flow,
 * including Google OAuth). The edge `validate_session_cookie` only checks the
 * JWT, so on its own it bounces those users from protected routes even though
 * the pages/API (via hazo_get_auth) consider them logged in.
 *
 * Match EXACT prefixed cookie names (not a suffix wildcard, which any
 * `…hazo_auth_user_id`-named cookie could satisfy). The cookies are written
 * server-side with the configured `cookie_prefix` (`darylweb_`). To stay robust
 * even if HAZO_AUTH_COOKIE_PREFIX is unavailable in the Edge runtime, check both
 * the env prefix and the hardcoded `darylweb_` (a non-secret value already in
 * committed config). This is no weaker than the rest of the app: hazo_get_auth
 * (which guards the actual page/data) trusts these same cookies and matches the
 * exact `darylweb_`-prefixed names.
 */
function hasSimpleAuthCookies(request: NextRequest): boolean {
  const prefixes = [...new Set([process.env.HAZO_AUTH_COOKIE_PREFIX, 'darylweb_'].filter(Boolean))];
  const userIdNames = prefixes.map((p) => `${p}hazo_auth_user_id`);
  const userEmailNames = prefixes.map((p) => `${p}hazo_auth_user_email`);

  let hasUserId = false;
  let hasUserEmail = false;
  for (const { name, value } of request.cookies.getAll()) {
    if (!value) continue;
    if (userIdNames.includes(name)) hasUserId = true;
    else if (userEmailNames.includes(name)) hasUserEmail = true;
  }
  return hasUserId && hasUserEmail;
}

export async function middleware(request: NextRequest) {
  const { valid } = await validate_session_cookie(request);
  if (!valid && !hasSimpleAuthCookies(request)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

/**
 * Protect only named human app pages.
 * Explicitly excludes /login, /hazo_auth/*, /autotest, /api/*, /_next/*, static assets.
 * `/explore/:path*` covers dynamic subroutes (device detail, group detail, group
 * create) — exact-path matchers alone would leave those unauthenticated.
 */
export const config = {
  matcher: [
    '/explore',
    '/explore/:path*',
    '/schedules',
    '/analytics',
    '/admin',
    '/admin/:path*',
    '/settings',
  ],
};
