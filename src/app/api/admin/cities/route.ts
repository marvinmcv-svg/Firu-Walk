// GET  /api/admin/cities → { cities: AdminCityDTO[], occupancy } — every city
//      with its zones, plus peak occupancy of launched zones (the expansion
//      rule: open a new city once existing zones are ≥70 % busy at peak).
// POST /api/admin/cities {key, name, centerLat, centerLng, prices, durations, peaks} → AdminCityDTO
//      New cities start switched off: add zones and walkers, then launch.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { adminCityList } from "@/lib/server/cities";
import { EXPAND_THRESHOLD_PCT, zoneUtilization } from "@/lib/server/growthMetrics";
import { CityCreate } from "./schema";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const [cities, zones] = await Promise.all([adminCityList(), zoneUtilization()]);
    return ok({
      cities,
      occupancy: {
        thresholdPct: EXPAND_THRESHOLD_PCT,
        zones: zones.length,
        busyZones: zones.filter((z) => z.readyToExpand).length,
      },
    });
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = CityCreate.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la ciudad inválidos.");
    const { durations, peaks, ...data } = parsed.data;
    if (await db.city.findUnique({ where: { key: data.key }, select: { id: true } })) {
      throw new ApiError(400, "Ya existe una ciudad con esa clave.");
    }
    const city = await db.city.create({
      data: { ...data, active: false, durationsJson: JSON.stringify(durations), peakJson: JSON.stringify(peaks) },
    });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "CITY_CREATED", entity: "city", entityId: city.id, detail: JSON.stringify(parsed.data) },
    });
    return ok((await adminCityList()).find((c) => c.id === city.id), { status: 201 });
  });
}
