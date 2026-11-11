// POST /api/admin/zones {cityId, key, name, centerLat, centerLng, sortOrder?} → zone
// Zone keys are unique across cities (booking links use ?zone=key).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { ZoneCreate } from "../cities/schema";

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = ZoneCreate.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la zona inválidos.");
    const city = await db.city.findUnique({ where: { id: parsed.data.cityId } });
    if (!city) throw new ApiError(404, "Ciudad no encontrada.");
    if (await db.zone.findUnique({ where: { key: parsed.data.key }, select: { id: true } })) {
      throw new ApiError(400, "Ya existe una zona con esa clave.");
    }
    const zone = await db.zone.create({ data: { ...parsed.data, city: city.name, active: true } });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "ZONE_CREATED", entity: "zone", entityId: zone.id, detail: JSON.stringify(parsed.data) },
    });
    return ok(zone, { status: 201 });
  });
}
