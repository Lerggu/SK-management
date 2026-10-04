import { RateLimitedError } from "@/platform/errors";

/**
 * Fixed-window rate limiter. In-memory, per server instance: sufficient for V1
 * (single instance). Replace the store with Redis/Postgres before scaling out —
 * recorded as a known limitation.
 */
interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  signIn: { name: "sign-in", limit: 10, windowMs: 5 * 60_000 },
  upload: { name: "upload", limit: 30, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

const windows = new Map<string, Window>();

export function checkRateLimit(rule: RateLimitRule, key: string, now = Date.now()): void {
  const id = `${rule.name}:${key}`;
  const w = windows.get(id);
  if (!w || w.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + rule.windowMs });
    return;
  }
  if (w.count >= rule.limit) {
    throw new RateLimitedError(Math.ceil((w.resetAt - now) / 1000));
  }
  w.count += 1;
}

export function resetRateLimits(): void {
  windows.clear();
}
