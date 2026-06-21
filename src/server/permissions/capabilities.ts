export const CAPABILITIES = [
  'device.block',
  'device.unblock',
  'group.block',
  'group.unblock',
  'schedule.create',
  'schedule.cancel',
] as const;

export type Capability = typeof CAPABILITIES[number];

export function isCapability(x: string): x is Capability {
  return (CAPABILITIES as readonly string[]).includes(x);
}
