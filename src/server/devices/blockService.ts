import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import { createCrudService } from 'hazo_connect/server';
import { HazoState } from 'hazo_state/server';
import { wrapWithAudit, createAuditedCrudService, emitIntentEvent, runWithAuditContext } from 'hazo_audit/server';
import type { RouterProvider } from '../router/RouterProvider';
import type { DeviceRow } from './deviceService';

const blockKey = (deviceId: string) => `block:${deviceId}`;

export interface BlockActor { userId?: string | null; label: string; }
export interface BlockResult {
  device: DeviceRow;
  blocked: boolean;
  alreadyInState: boolean;
  routerSynced: boolean;
  providerMessage: string;
}
export class BlockServiceError extends Error {
  code: 'NOT_FOUND' | 'DEVICE_OFFLINE';
  constructor(code: 'NOT_FOUND' | 'DEVICE_OFFLINE', message: string) {
    super(message);
    this.name = 'BlockServiceError';
    this.code = code;
  }
}

// CAS-set the hazo_state desired-state marker, retrying on ConflictError.
async function setBlockMarker(adapter: HazoConnectAdapter, deviceId: string, blocked: boolean): Promise<void> {
  const state = new HazoState(adapter);
  const key = blockKey(deviceId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await state.get(key);
    try {
      await state.set(key, { blocked }, { expectedVersion: cur?.version ?? 0 });
      return;
    } catch (e) {
      if ((e as { type?: string })?.type === 'ConflictError') continue;
      throw e;
    }
  }
  throw new Error(`setBlockMarker: CAS retries exhausted for ${key}`);
}

export async function getBlockRow(adapter: HazoConnectAdapter, deviceId: string) {
  return createCrudService(adapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false }).findById(deviceId);
}

export async function blockDevice(
  adapter: HazoConnectAdapter,
  provider: RouterProvider,
  deviceId: string,
  opts: { actor: BlockActor; reason?: string },
): Promise<BlockResult> {
  const device = await createCrudService<DeviceRow>(adapter, 'app_devices').findById(deviceId);
  if (!device) throw new BlockServiceError('NOT_FOUND', 'Device not found');
  if (device.status !== 'online') throw new BlockServiceError('DEVICE_OFFLINE', 'Device is offline');

  const blockSvc = createCrudService(adapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false });
  const existing = await blockSvc.findById(deviceId) as Record<string, unknown> | null;
  if (existing && Number(existing.is_blocked) === 1) {
    return { device, blocked: true, alreadyInState: true, routerSynced: Number(existing.router_synced) === 1, providerMessage: 'already blocked' };
  }

  const mac = String(device.mac);
  const result = await provider.setInternetAccess(mac, false); // false = block
  const routerSynced = result.success;

  const auditedAdapter = wrapWithAudit(adapter);
  const auditedBlock = createAuditedCrudService(auditedAdapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false });
  const now = new Date().toISOString();
  const row = {
    device_id: deviceId, is_blocked: 1, blocked_by: opts.actor.label, blocked_at: now,
    reason: opts.reason ?? null, scheduled_unblock_at: null, unblock_job_id: null,
    router_synced: routerSynced ? 1 : 0,
  };

  await runWithAuditContext(
    { actor_kind: 'user', actor_user_id: opts.actor.userId ?? null, actor_label: opts.actor.label },
    async () => {
      if (existing) await auditedBlock.updateById(deviceId, row, { audit: { before_row: existing } });
      else await auditedBlock.insert(row, { audit: {} });
      await setBlockMarker(adapter, deviceId, true);
      await emitIntentEvent(adapter, {
        event_name: 'device_blocked', subject_kind: 'device', subject_id: deviceId,
        payload: { mac, reason: opts.reason ?? null, router_synced: routerSynced },
      });
    },
  );

  const updated = (await blockSvc.findById(deviceId)) as DeviceRow | null;
  return { device: updated ?? device, blocked: true, alreadyInState: false, routerSynced, providerMessage: result.message };
}

export async function unblockDevice(
  adapter: HazoConnectAdapter,
  provider: RouterProvider,
  deviceId: string,
  opts: { actor: BlockActor },
): Promise<BlockResult> {
  const device = await createCrudService<DeviceRow>(adapter, 'app_devices').findById(deviceId);
  if (!device) throw new BlockServiceError('NOT_FOUND', 'Device not found');

  const blockSvc = createCrudService(adapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false });
  const existing = await blockSvc.findById(deviceId) as Record<string, unknown> | null;
  if (!existing || Number(existing.is_blocked) === 0) {
    return { device, blocked: false, alreadyInState: true, routerSynced: true, providerMessage: 'already unblocked' };
  }

  const mac = String(device.mac);
  const result = await provider.setInternetAccess(mac, true); // true = unblock
  const routerSynced = result.success;

  const auditedAdapter = wrapWithAudit(adapter);
  const auditedBlock = createAuditedCrudService(auditedAdapter, 'app_block_state', { primaryKeys: ['device_id'], autoId: false });
  const row = {
    device_id: deviceId, is_blocked: 0, blocked_by: null, blocked_at: null, reason: null,
    scheduled_unblock_at: null, unblock_job_id: null, router_synced: routerSynced ? 1 : 0,
  };

  await runWithAuditContext(
    { actor_kind: 'user', actor_user_id: opts.actor.userId ?? null, actor_label: opts.actor.label },
    async () => {
      await auditedBlock.updateById(deviceId, row, { audit: { before_row: existing } });
      await setBlockMarker(adapter, deviceId, false);
      await emitIntentEvent(adapter, {
        event_name: 'device_unblocked', subject_kind: 'device', subject_id: deviceId,
        payload: { mac, router_synced: routerSynced },
      });
    },
  );

  const updated = (await blockSvc.findById(deviceId)) as DeviceRow | null;
  return { device: updated ?? device, blocked: false, alreadyInState: false, routerSynced, providerMessage: result.message };
}
