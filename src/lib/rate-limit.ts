import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Rate limiting (FIX_IMPLEMENTATION_PLAN FX-14 / FX-45, audit M13).
 *
 * With the Postgres store the counters live in commerceos.rate_limits, so every app server shares them: a sign-in
 * guessed on one server counts on all of them (ADR-109). Keys are stored as SHA-256 hashes (some contain emails).
 * The estimate is a sliding window: this window's hits plus the previous window's, weighted by how much of it still
 * overlaps. If Postgres can't be reached, or without it (tests, the JSON file), this server's in-memory limits apply,
 * so protection never drops to nothing.
 */
const windows = new Map<string, number[]>();
const MAX_KEYS = 50_000;
/** Bumped by resetRateLimitsForTesting so shared counters start fresh without touching the database. */
let generation = 0;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

function checkLocal(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
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

export async function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  const hashed = crypto.createHash("sha256").update(`${generation}:${key}`).digest("hex");
  try {
    const shared = await db.rateLimitHit(hashed, windowMs, now);
    if (shared) {
      const overlap = 1 - shared.elapsedMs / windowMs;
      const estimate = shared.current + shared.previous * overlap;
      if (estimate > limit) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - shared.elapsedMs) / 1000)) };
      }
      return { allowed: true, retryAfterSec: 0 };
    }
  } catch (err) {
    logger.warn("rate_limit.shared_unavailable", { error: (err as Error).message });
  }
  return checkLocal(key, limit, windowMs, now);
}

/** Throws a 429 (with retry_after_sec, sent as Retry-After by apiError) when the key is over its limit. */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const result = await checkRateLimit(key, limit, windowMs);
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

/** For tests only: forget every counter (local ones are cleared; shared ones are left behind under an old prefix). */
export function resetRateLimitsForTesting(): void {
  windows.clear();
  generation++;
}
