// Redis client (optional until Milestone 2). Returns null when REDIS_URL is
// not configured so callers can degrade gracefully.

import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis: Redis | null | undefined };

export function getRedis(): Redis | null {
  if (globalForRedis.redis !== undefined) return globalForRedis.redis;
  const url = process.env.REDIS_URL;
  globalForRedis.redis = url
    ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false })
    : null;
  return globalForRedis.redis;
}
