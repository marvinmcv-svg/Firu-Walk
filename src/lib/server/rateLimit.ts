// Fixed-window rate limiter shared by every instance: Redis when REDIS_URL is
// configured, otherwise a Postgres table (RateLimit). Never in-process memory,
// which resets per serverless instance.

import { db } from "@/lib/db";
import { ApiError } from "./http";
import { log } from "./log";
import { getRedis } from "./redis";

export interface RateResult {
  ok: boolean;
  count: number;
  retryAfterSec: number;
}

async function hitRedis(key: string, windowMs: number): Promise<{ count: number; ttlMs: number } | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    const res = await redis.multi().incr(key).pexpire(key, windowMs, "NX").pttl(key).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttlMs = Number(res?.[2]?.[1] ?? windowMs);
    return { count, ttlMs: ttlMs > 0 ? ttlMs : windowMs };
  } catch (err) {
    // Redis down → fall back to Postgres rather than failing open or closed.
    log.warn("ratelimit.redis_error", { err });
    return null;
  }
}

async function hitPostgres(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + (${windowMs} * interval '1 millisecond'))
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  // Occasional cleanup of stale windows (≈1% of calls).
  if (Math.random() < 0.01) {
    await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 3_600_000) } } });
  }
  const row = rows[0]!;
  return { count: Number(row.count), ttlMs: Math.max(0, row.resetAt.getTime() - Date.now()) };
}

/** Count one hit for `key`; ok=false once more than `limit` hits land in the window. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const fullKey = `rl:${key}`;
  const r = (await hitRedis(fullKey, windowMs)) ?? (await hitPostgres(fullKey, windowMs));
  return { ok: r.count <= limit, count: r.count, retryAfterSec: Math.ceil(r.ttlMs / 1000) };
}

/** Same as rateLimit() but throws a Spanish 429 when exceeded. */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const r = await rateLimit(key, limit, windowMs);
  if (!r.ok) {
    const mins = Math.max(1, Math.ceil(r.retryAfterSec / 60));
    throw new ApiError(429, `Demasiados intentos. Vuelve a intentarlo en ${mins} min.`);
  }
}
