import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validate_session_cookie } from 'hazo_auth/server/middleware';

export async function middleware(request: NextRequest) {
  const { valid } = await validate_session_cookie(request);
  if (!valid) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

/**
 * Protect only named human app pages.
 * Explicitly excludes /login, /hazo_auth/*, /autotest, /api/*, /_next/*, static assets.
 */
export const config = {
  matcher: ['/', '/explore', '/schedules', '/analytics', '/admin', '/settings'],
};
