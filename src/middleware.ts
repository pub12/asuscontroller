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
 * Match by cookie-name SUFFIX rather than reconstructing the prefixed name:
 * the cookies are written server-side with the configured `cookie_prefix`
 * (e.g. `darylweb_`), but the Edge runtime may not have HAZO_AUTH_COOKIE_PREFIX
 * available — a suffix match finds them regardless of prefix availability.
 * This is no weaker than the rest of the app: hazo_get_auth (which guards the
 * actual page/data) already trusts these same cookies.
 */
function hasSimpleAuthCookies(request: NextRequest): boolean {
  let hasUserId = false;
  let hasUserEmail = false;
  for (const { name, value } of request.cookies.getAll()) {
    if (!value) continue;
    if (name.endsWith('hazo_auth_user_id')) hasUserId = true;
    else if (name.endsWith('hazo_auth_user_email')) hasUserEmail = true;
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
