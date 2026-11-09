// Worker step: remind each walker `safety.reminderMinutesBefore` minutes
// before a walk (once per walk; 0 turns it off).

import { db } from "@/lib/db";
import type { AppConfig } from "@/lib/firu/types";
import { notifyEvent } from "../notify";

export async function sendWalkReminders(cfg: AppConfig, now = new Date()): Promise<number> {
  const minutes = cfg.safety.reminderMinutesBefore;
  if (!minutes || minutes <= 0) return 0;
  const due = await db.walk.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      scheduledStart: { gt: now, lte: new Date(now.getTime() + minutes * 60_000) },
    },
    select: { id: true, walkerId: true, zoneId: true, scheduledStart: true, dog: { select: { name: true } } },
    take: 100,
  });
  const zones = new Map(
    (await db.zone.findMany({ where: { id: { in: [...new Set(due.map((w) => w.zoneId))] } } })).map((z) => [z.id, z.name])
  );
  let sent = 0;
  for (const w of due) {
    const claimed = await db.walk.updateMany({
      where: { id: w.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claimed.count === 0) continue;
    await notifyEvent(w.walkerId, "walk_reminder", {
      dogName: w.dog?.name ?? "tu perrito",
      zoneName: zones.get(w.zoneId) ?? "",
      startsAt: w.scheduledStart,
      walkId: w.id,
    });
    sent++;
  }
  return sent;
}
