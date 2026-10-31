// GET  /api/admin/plans → PlanDTO[] (all, including inactive)
// POST /api/admin/plans {key, name, walks, durationMin, priceCents, periodDays?} → PlanDTO

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { planOf } from "@/lib/server/payments/plans";
import { PlanInput } from "./schema";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const cfg = await getAppConfig();
    const plans = await db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }] });
    return ok(plans.map((p) => planOf(p, cfg)));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = PlanInput.required({ key: true, name: true, walks: true, priceCents: true }).safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos del plan inválidos.");
    if (await db.plan.findUnique({ where: { key: parsed.data.key } })) {
      throw new ApiError(400, "Ya existe un plan con esa clave.");
    }
    const plan = await db.plan.create({ data: parsed.data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "PLAN_CREATED", entity: "plan", entityId: plan.id, detail: JSON.stringify(parsed.data) },
    });
    return ok(planOf(plan, await getAppConfig()), { status: 201 });
  });
}
