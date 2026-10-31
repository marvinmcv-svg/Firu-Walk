// GET /api/health → 200 {status:"ok", checks} | 503 {status:"degraded", checks}
// Liveness/readiness probe for uptime monitors, Docker and load balancers.
// Public on purpose: it exposes only up/down per dependency, never errors.

import { db } from "@/lib/db";
import { log } from "@/lib/server/log";
import { getRedis } from "@/lib/server/redis";

export const dynamic = "force-dynamic";

type Check = "ok" | "down" | "not_configured";

const TIMEOUT_MS = 3_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
  ]);
}

async function checkDb(): Promise<Check> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`);
    return "ok";
  } catch (err) {
    log.error("health.db_down", { err });
    return "down";
  }
}

async function checkRedis(): Promise<Check> {
  const redis = getRedis();
  if (!redis) return "not_configured";
  try {
    if (redis.status === "wait") await withTimeout(redis.connect());
    await withTimeout(redis.ping());
    return "ok";
  } catch (err) {
    log.error("health.redis_down", { err });
    return "down";
  }
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDb(), checkRedis()]);
  const healthy = database === "ok" && redis !== "down";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { database, redis },
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
