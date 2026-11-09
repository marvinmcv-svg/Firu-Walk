// GET /api/walks/backup-offers → BackupOfferDTO[] — late walks currently
// offered to the signed-in walker. The address is only revealed once taken.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireWalker } from "@/lib/server/session";
import type { BackupOfferDTO } from "@/lib/firu/types";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    const walks = await db.walk.findMany({
      where: { backupWalkerId: user.id, status: "SCHEDULED", backupExpiresAt: { gt: new Date() } },
      include: { dog: { select: { name: true, photoUrl: true } } },
      orderBy: { scheduledStart: "asc" },
    });
    const zones = new Map(
      (await db.zone.findMany({ where: { id: { in: walks.map((w) => w.zoneId) } } })).map((z) => [z.id, z.name])
    );
    const out: BackupOfferDTO[] = walks.map((w) => ({
      walkId: w.id,
      dogName: w.dog?.name ?? "",
      dogPhotoUrl: w.dog?.photoUrl ?? null,
      zoneName: zones.get(w.zoneId) ?? "",
      scheduledStart: w.scheduledStart.toISOString(),
      durationMin: w.durationMin,
      expiresAt: w.backupExpiresAt!.toISOString(),
    }));
    return ok(out);
  });
}
