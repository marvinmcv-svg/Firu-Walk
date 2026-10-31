// GET /api/plans → PlanDTO[] active monthly plans (public catalogue), with the
// owner service fee breakdown from Config.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { getAppConfig } from "@/lib/server/config";
import { planOf } from "@/lib/server/payments/plans";

export async function GET() {
  return run(async () => {
    const [cfg, plans] = await Promise.all([
      getAppConfig(),
      db.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }] }),
    ]);
    return ok(plans.map((p) => planOf(p, cfg)));
  });
}
