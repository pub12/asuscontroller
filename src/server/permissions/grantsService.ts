import 'server-only';
import { randomUUID } from 'crypto';
import { createCrudService } from 'hazo_connect/server';
import type { HazoConnectAdapter } from 'hazo_connect/server';

export interface GrantRow extends Record<string, unknown> {
  id: string;
  subject: string;
  capability: string;
  scope_type: string | null;
  scope_id: string | null;
  status: string;
  granted_by: string | null;
  granted_at: string;
}

export interface RequestRow extends Record<string, unknown> {
  id: string;
  subject: string;
  capability: string;
  scope_type: string | null;
  scope_id: string | null;
  note: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

function grantsSvc(adapter: HazoConnectAdapter) {
  return createCrudService<GrantRow>(adapter, 'app_user_grants');
}

function requestsSvc(adapter: HazoConnectAdapter) {
  return createCrudService<RequestRow>(adapter, 'app_access_requests');
}

export async function listGrants(
  adapter: HazoConnectAdapter,
  filter?: { subject?: string; status?: string },
): Promise<GrantRow[]> {
  const svc = grantsSvc(adapter);
  if (!filter || (!filter.subject && !filter.status)) {
    return svc.list();
  }
  const criteria: Record<string, unknown> = {};
  if (filter.subject) criteria.subject = filter.subject;
  if (filter.status) criteria.status = filter.status;
  return svc.findBy(criteria);
}

export async function findActiveGrants(
  adapter: HazoConnectAdapter,
  subject: string,
  capability: string,
): Promise<GrantRow[]> {
  return grantsSvc(adapter).findBy({ subject, capability, status: 'active' });
}

export async function createGrant(
  adapter: HazoConnectAdapter,
  params: {
    subject: string;
    capability: string;
    scopeType: string | null;
    scopeId: string | null;
    grantedBy: string | null;
  },
): Promise<GrantRow> {
  const svc = grantsSvc(adapter);
  const now = new Date().toISOString();

  // Null-safe idempotency check done in application code: SQLite UNIQUE
  // constraints treat NULL as distinct, so two global grants (scope_id NULL)
  // would NOT collide at the DB level. We must dedupe here instead. Match by
  // (subject, capability) at the DB, then compare scope in JS with null-coalescing.
  const candidates = await svc.findBy({
    subject: params.subject,
    capability: params.capability,
  });
  const match = candidates.find(
    (g) =>
      (g.scope_type ?? null) === (params.scopeType ?? null) &&
      (g.scope_id ?? null) === (params.scopeId ?? null),
  );
  if (match) {
    if (match.status === 'revoked') {
      const updated = await svc.updateById(match.id as string, {
        status: 'active',
        granted_by: params.grantedBy,
        granted_at: now,
      });
      return updated[0];
    }
    // Already exists (active) — idempotent success.
    return match;
  }

  const rows = await svc.insert({
    id: randomUUID(),
    subject: params.subject,
    capability: params.capability,
    scope_type: params.scopeType,
    scope_id: params.scopeId,
    status: 'active',
    granted_by: params.grantedBy,
    granted_at: now,
  });
  return rows[0];
}

export async function revokeGrant(
  adapter: HazoConnectAdapter,
  id: string,
  by: string | null,
): Promise<GrantRow | null> {
  const svc = grantsSvc(adapter);
  const existing = await svc.findById(id);
  if (!existing) return null;
  const updated = await svc.updateById(id, { status: 'revoked', granted_by: by });
  return updated[0] ?? null;
}

export async function listRequests(
  adapter: HazoConnectAdapter,
  filter?: { subject?: string; status?: string },
): Promise<RequestRow[]> {
  const svc = requestsSvc(adapter);
  if (!filter || (!filter.subject && !filter.status)) {
    return svc.list();
  }
  const criteria: Record<string, unknown> = {};
  if (filter.subject) criteria.subject = filter.subject;
  if (filter.status) criteria.status = filter.status;
  return svc.findBy(criteria);
}

export async function createRequest(
  adapter: HazoConnectAdapter,
  params: {
    subject: string;
    capability: string;
    scopeType: string | null;
    scopeId: string | null;
    note?: string | null;
  },
): Promise<RequestRow> {
  const svc = requestsSvc(adapter);
  const now = new Date().toISOString();
  const rows = await svc.insert({
    id: randomUUID(),
    subject: params.subject,
    capability: params.capability,
    scope_type: params.scopeType,
    scope_id: params.scopeId,
    note: params.note ?? null,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    created_at: now,
  });
  return rows[0];
}

export async function approveRequest(
  adapter: HazoConnectAdapter,
  id: string,
  by: string | null,
): Promise<{ request: RequestRow; grant: GrantRow } | null> {
  const svc = requestsSvc(adapter);
  const existing = await svc.findById(id);
  if (!existing || existing.status !== 'pending') return null;

  const now = new Date().toISOString();
  const updated = await svc.updateById(id, {
    status: 'approved',
    decided_by: by,
    decided_at: now,
  });
  const request = updated[0];

  const grant = await createGrant(adapter, {
    subject: request.subject as string,
    capability: request.capability as string,
    scopeType: (request.scope_type as string | null) ?? null,
    scopeId: (request.scope_id as string | null) ?? null,
    grantedBy: by,
  });

  return { request, grant };
}

export async function declineRequest(
  adapter: HazoConnectAdapter,
  id: string,
  by: string | null,
): Promise<RequestRow | null> {
  const svc = requestsSvc(adapter);
  const existing = await svc.findById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated = await svc.updateById(id, {
    status: 'declined',
    decided_by: by,
    decided_at: now,
  });
  return updated[0] ?? null;
}
