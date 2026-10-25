// GET /api/zones → ZoneDTO[] (active only, sorted by sortOrder)

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { zoneOf } from "@/lib/server/serialize";

export async function GET() {
  return run(async () => {
    const zones = await db.zone.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    });
    return ok(zones.map(zoneOf));
  });
}
