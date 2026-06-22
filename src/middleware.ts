import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validate_session_cookie } from 'hazo_auth/server/middleware';

/**
 * Mirror hazo_get_auth's fallback: when the JWT session cookie is absent or
 * invalid, hazo_auth still treats a request as authenticated if the simple
 * `user_id` + `user_email` cookies are present (set by some login flows, e.g.
 * Google OAuth). The edge `validate_session_cookie` only checks the JWT, so on
 * its own it would bounce those users from protected routes even though the
 * pages/API (via hazo_get_auth) consider them logged in. Check the same simple
 * cookies here to keep the gate consistent. Base names match
 * hazo_auth's BASE_COOKIE_NAMES; prefix comes from HAZO_AUTH_COOKIE_PREFIX.
 */
function hasSimpleAuthCookies(request: NextRequest): boolean {
  const prefix = process.env.HAZO_AUTH_COOKIE_PREFIX ?? '';
  const userId = request.cookies.get(`${prefix}hazo_auth_user_id`)?.value;
  const userEmail = request.cookies.get(`${prefix}hazo_auth_user_email`)?.value;
  return Boolean(userId && userEmail);
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
