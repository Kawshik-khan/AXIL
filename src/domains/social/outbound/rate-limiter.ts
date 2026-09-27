export class ChannelRateLimiter {
  private static buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private static readonly CAPACITY = 25; // max burst tokens
  private static readonly REFILL_RATE_PER_SEC = 5; // 5 messages per second

  public static tryConsume(channelId: string, cost = 1): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    let bucket = this.buckets.get(channelId);

    if (!bucket) {
      bucket = { tokens: this.CAPACITY, lastRefill: now };
      this.buckets.set(channelId, bucket);
    } else {
      // Refill tokens
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(this.CAPACITY, bucket.tokens + elapsedSeconds * this.REFILL_RATE_PER_SEC);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true };
    }

    const missingTokens = cost - bucket.tokens;
    const retryAfterMs = Math.ceil((missingTokens / this.REFILL_RATE_PER_SEC) * 1000);
    return { allowed: false, retryAfterMs };
  }
}
