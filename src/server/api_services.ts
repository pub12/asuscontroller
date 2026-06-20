/**
 * API-level services (rate limiting, etc.)
 *
 * Rate-limit approach: in-memory store via hazo_api/rate_limit.
 * The DB-backed path (createRateLimitService) expects a raw SQL adapter interface
 * (dialect + query(sql, params)) that hazo_connect's HazoConnectAdapter does not
 * expose. Rather than add a bespoke shim adapter, we use the in-process memory
 * store which is production-appropriate for single-instance deployments and
 * compiles cleanly. For multi-instance deployments, swap to a Redis-backed store.
 *
 * The MemoryRateLimitStore uses a sliding window counter; we adapt it to the
 * RateLimitService (token-bucket consume()) interface expected by withRateLimit.
 */
import { getDefaultMemoryStore } from 'hazo_api/rate_limit';

const store = getDefaultMemoryStore();

/**
 * A RateLimitService backed by the in-memory store.
 * Adapts the store's sliding-window increment() to the consume() contract.
 */
export const rateLimitService = {
  async consume(input: {
    bucket_key: string;
    capacity: number;
    refill_rate: number;
    cost?: number;
  }): Promise<{ allowed: boolean; remaining: number; retry_after_sec: number }> {
    const windowMs = Math.round((input.capacity / input.refill_rate) * 1000);
    const state = await store.increment(input.bucket_key, windowMs, input.capacity);
    const allowed = state.count <= input.capacity;
    const remaining = Math.max(0, input.capacity - state.count);
    const retry_after_sec = allowed ? 0 : Math.ceil((state.resetAt - Date.now()) / 1000);
    return { allowed, remaining, retry_after_sec };
  },
};
