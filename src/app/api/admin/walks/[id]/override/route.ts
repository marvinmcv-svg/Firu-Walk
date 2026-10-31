// POST /api/admin/walks/[id]/override {phase:"start"|"end", reason} → {ok, phase}
// Lets the assigned walker start (or finish) this walk without being inside
// the pickup geofence — e.g. the owner's map pin is wrong or GPS is down.
// One use per phase; the reason is required and both the grant and its use
// are written to the audit log.

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { notify } from "@/lib/server/notify";

const BodySchema = z.object({
  phase: z.enum(["start", "end"]),
  reason: z.string().trim().min(5).max(300),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "Indica la fase (start o end) y un motivo de al menos 5 caracteres.");
    }
    const { phase, reason } = parsed.data;

    const walk = await db.walk.findUnique({ where: { id }, include: { dog: true } });
    if (!walk) throw new ApiError(404, "Paseo no encontrado.");
    const expected = phase === "start" ? "SCHEDULED" : "IN_PROGRESS";
    if (walk.status !== expected) {
      throw new ApiError(
        400,
        phase === "start"
          ? "Solo se puede autorizar el inicio de un paseo programado."
          : "Solo se puede autorizar el fin de un paseo en curso."
      );
    }

    await db.walk.update({
      where: { id },
      data: phase === "start" ? { startOverride: reason } : { endOverride: reason },
    });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "WALK_GEOFENCE_OVERRIDE",
        entity: "walk",
        entityId: id,
        detail: JSON.stringify({ phase, reason }),
      },
    });
    await notify(
      walk.walkerId,
      "WALK",
      phase === "start" ? "Inicio autorizado por soporte ✅" : "Cierre autorizado por soporte ✅",
      `Soporte te autorizó a ${phase === "start" ? "iniciar" : "finalizar"} el paseo de ${walk.dog?.name ?? "el perrito"} sin validar la ubicación. Motivo: ${reason}`,
      "walk-active"
    );
    return ok({ ok: true, phase });
  });
}
