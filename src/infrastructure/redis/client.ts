import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS — Upstash Redis Client
 * Serverless HTTP-based Redis for caching, rate limiting,
 * idempotency, session management, and event publishing.
 */

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// ── Client Singleton ───────────────────────────────────────────
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.'
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// ── Rate Limiters ──────────────────────────────────────────────

/**
 * API rate limiter: 60 requests per minute per tenant.
 * Uses sliding window algorithm for smooth rate enforcement.
 */
export function getApiRateLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'rl:api',
    analytics: true,
  });
}

/**
 * Messaging rate limiter: 10 messages per second with burst of 30.
 * Prevents hitting Meta/WhatsApp API rate limits.
 */
export function getMessagingRateLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.tokenBucket(10, '1 s', 30),
    prefix: 'rl:msg',
  });
}

/**
 * Automation rate limiter: 60 executions per minute per tenant.
 * Matches SECURITY.md spec for automation safety perimeter.
 */
export function getAutomationRateLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'rl:auto',
  });
}

// ── Cache Operations ───────────────────────────────────────────

export const cache = {
  /**
   * Get a cached value by key.
   */
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedis();
    return redis.get<T>(key);
  },

  /**
   * Set a cached value with optional TTL (default 5 minutes).
   */
  async set(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
    const redis = getRedis();
    await redis.set(key, value, { ex: ttlSeconds });
  },

  /**
   * Delete a cached key.
   */
  async del(key: string): Promise<void> {
    const redis = getRedis();
    await redis.del(key);
  },

  /**
   * Invalidate all cache keys matching a prefix pattern.
   * Useful for tenant-scoped cache busting.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    const redis = getRedis();
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }
  },
};

// ── Session Management ─────────────────────────────────────────

export const sessions = {
  /**
   * Cache authenticated session context after JWT verification.
   * Avoids DB lookup on every authenticated request.
   */
  async setSession(
    userId: string,
    sessionData: Record<string, unknown>,
    ttlSeconds: number = 3600
  ): Promise<void> {
    await cache.set(`session:${userId}`, sessionData, ttlSeconds);
  },

  /**
   * Get cached session. Returns null if expired or not found.
   */
  async getSession<T>(userId: string): Promise<T | null> {
    return cache.get<T>(`session:${userId}`);
  },

  /**
   * Invalidate a session (logout, role change, etc.).
   */
  async clearSession(userId: string): Promise<void> {
    await cache.del(`session:${userId}`);
  },
};

// ── Idempotency ────────────────────────────────────────────────

export const idempotency = {
  /**
   * Attempt to claim an idempotency key.
   * Returns true if the key was newly set (first occurrence).
   * Returns false if the key already exists (duplicate request).
   * 
   * Key format: `idem:{tenant_id}:{operation}:{unique_key}`
   * TTL: 24 hours (86400 seconds)
   */
  async claim(
    tenantId: string,
    operation: string,
    uniqueKey: string,
    ttlSeconds: number = 86400
  ): Promise<boolean> {
    const redis = getRedis();
    const key = `idem:${tenantId}:${operation}:${uniqueKey}`;
    const result = await redis.set(key, '1', { nx: true, ex: ttlSeconds });
    return result === 'OK';
  },

  /**
   * Check if an idempotency key exists without claiming.
   */
  async exists(
    tenantId: string,
    operation: string,
    uniqueKey: string
  ): Promise<boolean> {
    const redis = getRedis();
    const key = `idem:${tenantId}:${operation}:${uniqueKey}`;
    const result = await redis.exists(key);
    return result === 1;
  },
};

// ── Distributed Locks ──────────────────────────────────────────

export const locks = {
  /**
   * Acquire a distributed lock with TTL.
   * Used for inventory reservation during concurrent checkouts.
   * 
   * @returns Lock token if acquired, null if already held.
   */
  async acquire(
    lockKey: string,
    ttlSeconds: number = 15
  ): Promise<string | null> {
    const redis = getRedis();
    const token = `lock_${Date.now()}_${randomSuffix()}`;
    const result = await redis.set(`lock:${lockKey}`, token, {
      nx: true,
      ex: ttlSeconds,
    });
    return result === 'OK' ? token : null;
  },

  /**
   * Release a lock only if the token matches (prevent releasing someone else's lock).
   */
  async release(lockKey: string, token: string): Promise<boolean> {
    const redis = getRedis();
    const currentToken = await redis.get(`lock:${lockKey}`);
    if (currentToken === token) {
      await redis.del(`lock:${lockKey}`);
      return true;
    }
    return false;
  },
};

// ── Event Bus ──────────────────────────────────────────────────

export const eventBus = {
  /**
   * Publish a domain event.
   * Events are stored as Redis list entries for consumer processing.
   */
  async publish(
    eventType: string,
    tenantId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const redis = getRedis();
    const event = {
      event_id: `evt_${Date.now()}_${randomSuffix()}`,
      event_type: eventType,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      payload,
    };
    // Push to tenant-scoped event stream
    await redis.lpush(`events:${tenantId}`, JSON.stringify(event));
    // Also push to global stream for cross-tenant consumers
    await redis.lpush('events:global', JSON.stringify(event));
    // Trim to prevent unbounded growth (keep last 10K events per tenant)
    await redis.ltrim(`events:${tenantId}`, 0, 9999);
    await redis.ltrim('events:global', 0, 49999);
  },

  /**
   * Get recent events for a tenant.
   */
  async getRecentEvents(
    tenantId: string,
    limit: number = 50
  ): Promise<Record<string, unknown>[]> {
    const redis = getRedis();
    const raw = await redis.lrange(`events:${tenantId}`, 0, limit - 1);
    return raw.map((item) =>
      typeof item === 'string' ? JSON.parse(item) : item
    ) as Record<string, unknown>[];
  },
};

// ── Health Check ───────────────────────────────────────────────

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
