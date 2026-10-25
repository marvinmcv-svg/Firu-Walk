// POST /api/walkers/match {zoneId, durationMin, schedule, excludeWalkerIds?}
// → { candidates: WalkerCardDTO[] } — rules-based ranking, max 4 (anti-shotgun).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqNum, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { matchWalkers, normalizeSchedule } from "@/lib/server/bookingEngine";
import type { BookingType } from "@/lib/server/bookingEngine";

export async function POST(req: Request) {
  return run(async () => {
    await requireUser(req);
    const body = await readJson(req);

    const zoneId = typeof body.zoneId === "string" ? body.zoneId : "";
    if (!zoneId) throw new ApiError(400, "La zona es obligatoria.");
    const zone = await db.zone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.active) throw new ApiError(400, "La zona seleccionada no está disponible.");

    // Infer the schedule shape when `type` is not provided:
    // items with `day` → recurring weekly slots; items with `date` → one-off.
    const rawSchedule = Array.isArray(body.schedule) ? body.schedule : [];
    const inferred: BookingType =
      body.type === "RECURRING" || body.type === "ONE_OFF"
        ? (body.type as BookingType)
        : rawSchedule.some((s) => s && typeof s === "object" && "day" in (s as object))
          ? "RECURRING"
          : "ONE_OFF";
    const type: BookingType = inferred;
    const durationMin = reqNum(body, "durationMin", "La duración", {
      min: 30,
      max: 60,
    });
    if (![30, 45, 60].includes(durationMin)) {
      throw new ApiError(400, "La duración debe ser de 30, 45 o 60 minutos.");
    }
    const schedule = normalizeSchedule(type, body.schedule);

    const exclude = Array.isArray(body.excludeWalkerIds)
      ? body.excludeWalkerIds.filter((x): x is string => typeof x === "string")
      : undefined;

    const candidates = await matchWalkers({
      zoneId,
      durationMin,
      schedule,
      excludeWalkerUserIds: exclude,
    });
    return ok({ candidates });
  });
}
