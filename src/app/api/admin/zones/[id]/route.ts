// PATCH /api/admin/zones/[id] {name?, centerLat?, centerLng?, sortOrder?, active?} → zone
// Switching a zone off is refused while it has pending walks or open bookings.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { assertNoOpenWork } from "@/lib/server/cities";
import { ZoneEdit } from "../../cities/schema";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = ZoneEdit.partial().safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la zona inválidos.");
    if (Object.keys(parsed.data).length === 0) throw new ApiError(400, "No hay cambios válidos que aplicar.");
    const zone = await db.zone.findUnique({ where: { id } });
    if (!zone) throw new ApiError(404, "Zona no encontrada.");
    if (parsed.data.active === false && zone.active) await assertNoOpenWork([id]);
    const updated = await db.zone.update({ where: { id }, data: parsed.data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "ZONE_UPDATED", entity: "zone", entityId: id, detail: JSON.stringify(parsed.data) },
    });
    return ok(updated);
  });
}
