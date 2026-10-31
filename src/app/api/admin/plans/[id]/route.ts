// PATCH /api/admin/plans/[id] {name?, walks?, durationMin?, priceCents?, periodDays?, active?, sortOrder?}
// Existing subscriptions keep the terms they were bought with.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { planOf } from "@/lib/server/payments/plans";
import { PlanInput } from "../schema";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = PlanInput.omit({ key: true }).safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos del plan inválidos.");
    if (Object.keys(parsed.data).length === 0) throw new ApiError(400, "No hay cambios válidos que aplicar.");
    const existing = await db.plan.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Plan no encontrado.");
    const plan = await db.plan.update({ where: { id }, data: parsed.data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "PLAN_UPDATED", entity: "plan", entityId: id, detail: JSON.stringify(parsed.data) },
    });
    return ok(planOf(plan, await getAppConfig()));
  });
}
