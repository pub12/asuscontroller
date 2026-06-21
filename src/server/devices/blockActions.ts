import 'server-only';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import type { RouterProvider } from '../router/RouterProvider';
import { blockDevice, unblockDevice, BlockServiceError, type BlockResult } from './blockService';

export type BlockAction = 'block' | 'unblock';
export type BlockActionOutcome =
  | { ok: true; result: BlockResult }
  | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED'; message: string };

export async function runBlockAction(
  adapter: HazoConnectAdapter,
  provider: RouterProvider,
  gate: { isSuperadmin: boolean; actorLabel: string },
  deviceId: string,
  action: BlockAction,
  reason?: string,
): Promise<BlockActionOutcome> {
  if (!gate.isSuperadmin) return { ok: false, code: 'FORBIDDEN', message: 'Superadmin required' };
  const actor = { label: gate.actorLabel };
  try {
    const result = action === 'block'
      ? await blockDevice(adapter, provider, deviceId, { actor, reason })
      : await unblockDevice(adapter, provider, deviceId, { actor });
    return { ok: true, result };
  } catch (e) {
    if (e instanceof BlockServiceError) {
      if (e.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: 'Device not found' };
      if (e.code === 'DEVICE_OFFLINE') return { ok: false, code: 'VALIDATION_FAILED', message: 'Device is offline' };
    }
    throw e;
  }
}
