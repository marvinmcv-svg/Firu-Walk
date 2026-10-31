// Scheduled jobs (Vercel Cron or any scheduler) call /api/cron/* with
// `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET the jobs are off.

import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/server/http";

export function requireCron(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new ApiError(503, "Tareas programadas desactivadas (CRON_SECRET).");
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new ApiError(401, "No autorizado.");
  }
}
