import 'server-only';
import { createCrudService } from 'hazo_connect/server';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import { emitIntentEvent, runWithAuditContext } from 'hazo_audit/server';
import type { Capability } from './capabilities';
import { findActiveGrants } from './grantsService';

export interface AuthorizeTarget {
  scopeType?: 'global' | 'group';
  scopeId?: string | null;
  deviceId?: string | null;
}

export interface AuthorizeDecision {
  allowed: boolean;
  reason: string;
}

export async function authorizeCapability(
  adapter: HazoConnectAdapter,
  auth: { subject: string | null; isSuperadmin: boolean },
  capability: Capability,
  target?: AuthorizeTarget,
): Promise<AuthorizeDecision> {
  let allowed = false;
  let reason = 'no matching grant';

  const subject = auth.subject;

  if (auth.isSuperadmin) {
    allowed = true;
    reason = 'superadmin';
  } else if (!subject) {
    allowed = false;
    reason = 'unauthenticated';
  } else {
    const grants = await findActiveGrants(adapter, subject, capability);

    // Global grant
    if (grants.some((g) => g.scope_type === 'global')) {
      allowed = true;
      reason = 'global grant';
    } else {
      // Determine action type: group action vs device action
      const isGroupAction =
        capability.startsWith('group.') ||
        (target?.deviceId == null && target?.scopeId != null);

      if (isGroupAction && target?.scopeId != null) {
        // Check for a group-scoped grant matching target.scopeId
        const matched = grants.some(
          (g) => g.scope_type === 'group' && g.scope_id === target.scopeId,
        );
        if (matched) {
          allowed = true;
          reason = 'group grant';
        }
      } else if (target?.deviceId != null) {
        // Device action: find all groups the device belongs to
        const memberRows = await createCrudService(
          adapter,
          'app_group_members',
          { primaryKeys: ['group_id', 'device_id'], autoId: false },
        ).findBy({ device_id: target.deviceId });

        const deviceGroupIds = new Set(memberRows.map((r) => r.group_id as string));

        const matched = grants.some(
          (g) => g.scope_type === 'group' && g.scope_id != null && deviceGroupIds.has(g.scope_id as string),
        );
        if (matched) {
          allowed = true;
          reason = 'group grant (device member)';
        }
      }
    }
  }

  const decision: AuthorizeDecision = { allowed, reason };

  // Emit audit intent — best-effort, never throws
  try {
    await runWithAuditContext(
      {
        actor_kind: 'user',
        actor_user_id: null,
        actor_label: subject ?? 'anonymous',
      },
      async () => {
        await emitIntentEvent(adapter, {
          event_name: 'capability_checked',
          subject_kind: 'capability',
          subject_id: capability,
          payload: {
            subject: subject ?? null,
            capability,
            scope_type: target?.scopeType ?? null,
            scope_id: target?.scopeId ?? null,
            device_id: target?.deviceId ?? null,
            decision: allowed ? 'allow' : 'deny',
            reason,
          },
        });
      },
    );
  } catch (auditErr) {
    console.warn('[authorize] audit emission failed (swallowed):', auditErr);
  }

  return decision;
}
