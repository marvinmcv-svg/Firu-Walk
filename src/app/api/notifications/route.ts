// GET   /api/notifications → NotificationDTO[] (own, latest 30, unread first)
// PATCH /api/notifications {action:"read-all"} → {ok, updated}

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { notificationOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ read: "asc" }, { createdAt: "desc" }],
      take: 30,
    });
    return ok(notifications.map(notificationOf));
  });
}

export async function PATCH(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const body = await readJson(req);
    const action = optStr(body, "action");
    if (action !== "read-all") {
      throw new ApiError(400, 'Acción inválida. Usa {"action":"read-all"}.');
    }
    const res = await db.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return ok({ ok: true, updated: res.count });
  });
}
