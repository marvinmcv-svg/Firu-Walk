// GET /api/walkers/[id] (id = USER id) → WalkerDetailDTO
// Marketplace detail: card + phone + experience + availability + latest 10 reviews.

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { walkerDetailOf } from "@/lib/server/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await db.user.findUnique({
      where: { id },
      include: { walker: true, zone: true },
    });
    if (!user || !user.walker) throw new ApiError(404, "El paseador no existe.");

    const [slots, reviews] = await Promise.all([
      db.availabilitySlot.findMany({ where: { walkerId: user.walker.id } }),
      db.review.findMany({
        where: { walkerId: user.id },
        include: { owner: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const zone = await db.zone.findUnique({ where: { id: user.walker.zoneId } });
    return ok(walkerDetailOf(user, user.walker, slots, reviews, zone?.name ?? user.zone?.name ?? ""));
  });
}
