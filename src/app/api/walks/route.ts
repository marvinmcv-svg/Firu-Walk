// GET /api/walks?scope=today|active|history → WalkDTO[] + booking context, role-scoped.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { boDayStart, boDayStartOffset } from "@/lib/server/botime";
import { bookingContextOf, walkInclude, walkOf, zonesById } from "@/lib/server/serialize";
import type { FullWalk } from "@/lib/server/serialize";

/** WalkDTO + booking context, using a prefetched zone map (no N+1). */
function withContext(w: FullWalk, zones: Map<string, { id: string; name: string; key: string }>) {
  return {
    ...walkOf(w),
    booking: w.booking
      ? bookingContextOf(w.booking, zones.get(w.booking.zoneId) ?? null)
      : null,
  };
}

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const scope = new URL(req.url).searchParams.get("scope") ?? "today";

    const roleScope =
      user.role === "OWNER"
        ? { ownerId: user.id }
        : user.role === "WALKER"
          ? { walkerId: user.id }
          : {};

    const todayStart = boDayStart();
    const tomorrowStart = boDayStartOffset(1);

    let walks: FullWalk[];
    if (scope === "active") {
      walks = await db.walk.findMany({
        where: { ...roleScope, status: "IN_PROGRESS" },
        include: walkInclude,
        orderBy: { scheduledStart: "asc" },
      });
    } else if (scope === "history") {
      walks = await db.walk.findMany({
        where: { ...roleScope, status: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] } },
        include: walkInclude,
        orderBy: { scheduledStart: "desc" },
        take: 60,
      });
    } else {
      // today: today's agenda + anything currently running
      walks = await db.walk.findMany({
        where: {
          ...roleScope,
          status: { not: "CANCELLED" },
          OR: [
            { status: "IN_PROGRESS" },
            { scheduledStart: { gte: todayStart, lt: tomorrowStart } },
          ],
        },
        include: walkInclude,
        orderBy: { scheduledStart: "asc" },
      });
    }
    const zones = await zonesById(
      walks.filter((w) => w.booking).map((w) => w.booking!.zoneId)
    );
    return ok(walks.map((w) => withContext(w, zones)));
  });
}
