/**
 * NetWarden application config — typed, validated, cached.
 *
 * Uses hazo_core loadConfig() which:
 *   1. Reads config/hazo_netwarden_config.ini (base)
 *   2. Applies env-var overrides HAZO_NETWARDEN_<SECTION>_<KEY>
 *   3. Validates with Zod and caches per env
 *
 * NOTE: hazo_core loadConfig expects the filename pattern
 *   config/hazo_<pkg>_config.ini  (e.g. hazo_netwarden_config.ini).
 * Our config file is named netwarden_config.ini, so we fall back to
 * HazoConfig from hazo_config/server and parse it ourselves.
 * This is documented here as a deliberate deviation — the app config
 * file predates the hazo_core naming convention and is kept consistent
 * with the existing hazo_auth_config.ini naming pattern in this repo.
 */
import { HazoConfig } from 'hazo_config/server';
import { z } from 'zod';
import path from 'path';

const ConfigSchema = z.object({
  session_gap_minutes: z.coerce.number().int().positive().default(5),
  min_active_floor_minutes: z.coerce.number().int().positive().default(1),
  device_poll_seconds: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let _cached: AppConfig | null = null;

/**
 * Return the parsed and validated NetWarden application config.
 * Result is cached in-process after the first call.
 */
export function getAppConfig(): AppConfig {
  if (_cached) return _cached;

  const configPath = path.resolve(process.cwd(), 'config', 'netwarden_config.ini');
  const cfg = new HazoConfig({ filePath: configPath });
  const raw = cfg.getSection('netwarden') ?? {};

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `[netwarden] Invalid netwarden_config.ini: ${parsed.error.message}`
    );
  }
  _cached = parsed.data;
  return _cached;
}
