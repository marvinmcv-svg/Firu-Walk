// GET /api/walkers?zoneId= → WalkerCardDTO[] (ACTIVE only, rating desc)

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { walkerCardOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    const zoneId = new URL(req.url).searchParams.get("zoneId") ?? undefined;
    const profiles = await db.walkerProfile.findMany({
      where: { status: "ACTIVE", ...(zoneId ? { zoneId } : {}) },
      include: { user: { include: { zone: true } }, zone: true },
    });
    const cards = profiles
      .map((p) => walkerCardOf(p.user, p, p.zone?.name ?? p.user.zone?.name ?? ""))
      .sort((a, b) => b.rating - a.rating || b.repeatOwners - a.repeatOwners);
    return ok(cards);
  });
}
