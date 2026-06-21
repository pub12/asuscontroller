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
  gate: { authorized: boolean; actorLabel: string; actorUserId?: string | null },
  deviceId: string,
  action: BlockAction,
  reason?: string,
  opts?: { jobs?: { cancel(id: string): Promise<{ cancelled: boolean; reason?: string }> } },
): Promise<BlockActionOutcome> {
  if (!gate.authorized) return { ok: false, code: 'FORBIDDEN', message: 'Not authorized' };
  const actor = { userId: gate.actorUserId ?? null, label: gate.actorLabel };
  try {
    const result = action === 'block'
      ? await blockDevice(adapter, provider, deviceId, { actor, reason })
      : await unblockDevice(adapter, provider, deviceId, { actor, jobs: opts?.jobs });
    return { ok: true, result };
  } catch (e) {
    if (e instanceof BlockServiceError) {
      if (e.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: 'Device not found' };
      if (e.code === 'DEVICE_OFFLINE') return { ok: false, code: 'VALIDATION_FAILED', message: 'Device is offline' };
    }
    throw e;
  }
}
