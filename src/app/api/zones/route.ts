// GET /api/zones[?city=key] → ZoneDTO[] — active zones of active cities,
// sorted by city then zone order.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { zoneOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    const city = new URL(req.url).searchParams.get("city");
    const zones = await db.zone.findMany({
      where: { active: true, cityRef: { active: true, ...(city ? { key: city } : {}) } },
      include: { cityRef: true },
      orderBy: [{ cityRef: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    });
    return ok(zones.map(zoneOf));
  });
}
