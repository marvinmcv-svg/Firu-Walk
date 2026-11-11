// GET /api/admin/metrics/growth → GrowthMetricsDTO
// The weekly review: retention cohorts, walks per owner, on-time starts,
// acquisition channels, referrals, contribution and the leakage signal.

import { growthMetrics } from "@/lib/server/growthMetrics";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    return ok(await growthMetrics());
  });
}
