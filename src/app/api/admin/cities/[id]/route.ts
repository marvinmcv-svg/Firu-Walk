// PATCH /api/admin/cities/[id] {name?, center?, prices?, durations?, peaks?, sortOrder?, active?} → AdminCityDTO
// Launch (active:true) needs at least one active zone; switching a city off
// is refused while its zones have pending walks or open bookings. The key
// never changes (it is the SEO page URL).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { adminCityList, assertNoOpenWork } from "@/lib/server/cities";
import { CityEdit } from "../schema";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = CityEdit.partial().safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la ciudad inválidos.");
    if (Object.keys(parsed.data).length === 0) throw new ApiError(400, "No hay cambios válidos que aplicar.");
    const city = await db.city.findUnique({ where: { id }, include: { zones: true } });
    if (!city) throw new ApiError(404, "Ciudad no encontrada.");

    const { durations, peaks, ...rest } = parsed.data;
    if (rest.active === true && !city.active && !city.zones.some((z) => z.active)) {
      throw new ApiError(400, "Agrega al menos una zona activa antes de lanzar la ciudad.");
    }
    if (rest.active === false && city.active) {
      await assertNoOpenWork(city.zones.map((z) => z.id));
    }
    await db.city.update({
      where: { id },
      data: {
        ...rest,
        ...(durations ? { durationsJson: JSON.stringify(durations) } : {}),
        ...(peaks ? { peakJson: JSON.stringify(peaks) } : {}),
      },
    });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: rest.active === true && !city.active ? "CITY_LAUNCHED" : "CITY_UPDATED",
        entity: "city",
        entityId: id,
        detail: JSON.stringify(parsed.data),
      },
    });
    return ok((await adminCityList()).find((c) => c.id === id));
  });
}
