import 'server-only';

import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { hazo_get_auth, get_auth_cache } from 'hazo_auth/server-lib';
import { SUPERADMIN_PERMISSION } from '@/lib/app_config';
import { ensureSuperadminByEmail } from './ensure_superadmin';
import { getDb } from './db';

export interface ServerAuthResult {
  authenticated: boolean;
  subject: string | null;
  permissions: string[];
  isSuperadmin: boolean;
}

/**
 * Resolves hazo_auth from a Server Component / route-handler context.
 * hazo_get_auth needs a NextRequest (reads cookies + client IP) — we
 * reconstruct one from next/headers so Server Components can call this too.
 */
export async function resolveServerAuth(): Promise<ServerAuthResult> {
  const headerStore = await headers();
  const cookieHeader = headerStore.get('cookie') ?? '';
  const xff = headerStore.get('x-forwarded-for') ?? '';
  const realIp = headerStore.get('x-real-ip') ?? '';

  const requestHeaders: Record<string, string> = {};
  if (cookieHeader) requestHeaders['cookie'] = cookieHeader;
  if (xff) requestHeaders['x-forwarded-for'] = xff;
  if (realIp) requestHeaders['x-real-ip'] = realIp;

  const fakeRequest = new NextRequest('http://internal.local/', { headers: requestHeaders });
  const result = await hazo_get_auth(fakeRequest);

  if (!result.authenticated) {
    return { authenticated: false, subject: null, permissions: [], isSuperadmin: false };
  }

  const email = result.user.email_address;
  const superadminEmail = process.env.SUPERADMIN_EMAIL;
  if (superadminEmail && email === superadminEmail && !result.permissions.includes(SUPERADMIN_PERMISSION)) {
    // self-heal: grant and invalidate cache so next request picks it up
    await ensureSuperadminByEmail(getDb(), email);
    get_auth_cache().invalidate_user(result.user.id);
  }

  const permissions = result.permissions;
  return {
    authenticated: true,
    subject: email,
    permissions,
    isSuperadmin: permissions.includes(SUPERADMIN_PERMISSION),
  };
}

/**
 * Guard for Server Components / route handlers that require superadmin.
 * Redirects to /login if not authenticated; throws 403 if authenticated but not superadmin.
 */
export async function requireSuperadmin(): Promise<ServerAuthResult> {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) {
    redirect('/login');
  }
  if (!auth.isSuperadmin) {
    throw new Error('Forbidden: superadmin permission required');
  }
  return auth;
}
