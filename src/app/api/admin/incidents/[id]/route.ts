// PATCH /api/admin/incidents/[id] {resolution} → resolves the incident (audit-logged).

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";

const Body = z.object({
  resolution: z.string().trim().min(3, "Describe cómo se resolvió (mínimo 3 caracteres).").max(800),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const done = await db.incidentLog.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "RESOLVED", resolution: parsed.data.resolution, resolvedById: admin.id, resolvedAt: new Date() },
    });
    if (done.count === 0) {
      const exists = await db.incidentLog.findUnique({ where: { id }, select: { id: true } });
      throw new ApiError(exists ? 400 : 404, exists ? "El incidente ya estaba resuelto." : "Incidente no encontrado.");
    }
    await db.auditLog.create({
      data: { actorId: admin.id, action: "INCIDENT_RESOLVED", entity: "incident", entityId: id, detail: parsed.data.resolution },
    });
    return ok({ ok: true });
  });
}
