import { AppError } from "@/lib/errors";

/**
 * In-memory sliding-window rate limiting (FIX_IMPLEMENTATION_PLAN FX-14, audit M13).
 *
 * The app runs as exactly one replica until the Postgres cutover (decision D3, FX-45), so process memory is the
 * source of truth. Move this to Redis (src/infrastructure/redis/client.ts) when running more than one replica.
 */
const windows = new Map<string, number[]>();
const MAX_KEYS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > MAX_KEYS) {
    for (const [k, v] of Array.from(windows.entries())) {
      if (!v.length || now - v[v.length - 1] > windowMs) windows.delete(k);
    }
    // Still full (a flood of unique keys): drop the oldest keys so memory stays bounded.
    for (const k of Array.from(windows.keys())) {
      if (windows.size <= MAX_KEYS * 0.9) break;
      windows.delete(k);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Throws a 429 (with retry_after_sec, sent as Retry-After by apiError) when the key is over its limit. */
export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests. Try again later.", 429, { retry_after_sec: result.retryAfterSec });
  }
}

/**
 * The client's address, only when a trusted reverse proxy sets X-Forwarded-For (TRUST_PROXY=1). Without one there is
 * no trustworthy client identity in a route handler, so per-client limits are skipped rather than collapsing every
 * visitor into one shared bucket that an attacker could exhaust for everyone.
 */
export function clientKey(request: Request): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;
  // Proxies append the address they saw on the right; everything to the left of our trusted hops is client-supplied
  // and could be forged. TRUST_PROXY_HOPS is how many proxies we run (default 1).
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1);
  const entries = (request.headers.get("x-forwarded-for") || "").split(",").map((e) => e.trim()).filter(Boolean);
  return entries.length >= hops ? entries[entries.length - hops] : null;
}

export const MINUTE = 60_000;

/** For tests only: forget every counter. */
export function resetRateLimitsForTesting(): void {
  windows.clear();
}
