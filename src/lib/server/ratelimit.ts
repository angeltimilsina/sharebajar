/** Simple in-memory token bucket per key (IP). Good enough for one instance;
 *  swap for Redis/Upstash when running multiple instances. */
const g = globalThis as unknown as { __sbBuckets?: Map<string, { tokens: number; updated: number }> };
const buckets = (g.__sbBuckets ??= new Map());

export function rateLimit(key: string, capacity: number, refillPerMinute: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  const refill = ((now - b.updated) / 60_000) * refillPerMinute;
  b.tokens = Math.min(capacity, b.tokens + refill);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil(((1 - b.tokens) / refillPerMinute) * 60) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) buckets.clear();
  return { ok: true, retryAfter: 0 };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
