// GET /api/cron/minute (CRON_SECRET) — every minute, from the worker
// (scripts/worker.ts / live-service) or any scheduler:
//   1. booking accept-timeout sweep (next candidate / declined)
//   2. late-start detection → owner + ops alerts, backup-walker chain
//   3. expired backup offers → next backup
//   4. walker reminders before each walk
// Single-flight: an overlapping call returns {skipped:true}.

import { ok, run } from "@/lib/server/http";
import { jobBody, minuteJobs, runJob } from "@/lib/server/jobs";
import { requireCron } from "../auth";

export async function GET(req: Request) {
  return run(async () => {
    requireCron(req);
    const by = new URL(req.url).searchParams.get("by") === "worker" ? "worker" : "cron";
    return ok(jobBody(await runJob("minute", by, minuteJobs)));
  });
}
