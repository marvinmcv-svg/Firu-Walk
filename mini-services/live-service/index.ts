// index.ts — FiruWalk live-service entry. See server.ts for the protocol.
//
// Env:
//   PORT                 public socket.io port (default 3003; gateway path "/")
//   LIVE_INTERNAL_PORT   internal publish API for the Next.js app (default 3004)
//   REALTIME_SECRET      shared HS256 key with the app (required in production)
//   REDIS_URL            optional — Redis adapter for multiple instances
//   LIVE_CORS_ORIGINS    optional comma-separated allowed origins

import { createLiveServer } from "./server";
import { DEV_REALTIME_SECRET } from "./token";

const env = process.env;
const production = env.NODE_ENV === "production";

if (production && (!env.REALTIME_SECRET || env.REALTIME_SECRET.length < 32)) {
  console.error("[live] REALTIME_SECRET (≥32 chars) is required in production");
  process.exit(1);
}

const server = createLiveServer({
  secret: env.REALTIME_SECRET || DEV_REALTIME_SECRET,
  redisUrl: env.REDIS_URL || undefined,
  corsOrigins: env.LIVE_CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
});

const { port, internalPort } = await server.listen(
  Number(env.PORT) || 3003,
  Number(env.LIVE_INTERNAL_PORT) || 3004,
);
console.log(
  `[live] listening on :${port} (socket.io path "/"), internal :${internalPort}` +
    `, redis=${env.REDIS_URL ? "on" : "off"}`,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`[live] received ${signal} — shutting down`);
  await server.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
