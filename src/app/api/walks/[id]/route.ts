// GET   /api/walks/[id] → full detail (parsed track, report, booking context,
//        pickup point, last stored GPS seq)
// PATCH /api/walks/[id] {action:"start"|"finish"|"no_show", lat?, lng?, acc?, mock?}
//   start:  SCHEDULED→IN_PROGRESS (within 60min window), walker within the
//           geofence of the owner's address (or an admin override)
//   finish: IN_PROGRESS→COMPLETED, same geofence + report + money settlement.
//           Track and distance come from the uploaded GPS fixes, never the body.
//   no_show: SCHEDULED→NO_SHOW (owner absent at pickup)

import { db } from "@/lib/db";
import { z } from "zod";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { notify } from "@/lib/server/notify";
import { publishRealtime } from "@/lib/server/realtime";
import { settleCompletedWalk } from "@/lib/server/payments/settle";
import { formatBOB } from "@/lib/firu/money";
import { ensurePendingPayment } from "@/lib/server/bookingEngine";
import { geofenceDistance } from "@/lib/server/tracking";
import type { AppConfig } from "@/lib/firu/types";
import { bookingContextOf, walkDetailOf, walkInclude, zonesById } from "@/lib/server/serialize";
import type { FullWalk } from "@/lib/server/serialize";

const START_WINDOW_MS = 60 * 60 * 1000; // may start up to 60 min early

const PositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  acc: z.number().min(0).max(100_000).nullish(),
  mock: z.boolean().optional(),
});
type Position = z.infer<typeof PositionSchema>;

async function withContext(w: FullWalk) {
  const [zones, lastPoint] = await Promise.all([
    zonesById(w.booking ? [w.booking.zoneId] : []),
    db.walkTrackPoint.findFirst({
      where: { walkId: w.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    }),
  ]);
  const owner = w.booking?.owner;
  return {
    ...walkDetailOf(w),
    // Where the walk starts and ends (the owner's address). Only the owner,
    // the assigned walker and admins can read a walk.
    pickup:
      owner?.addressLat != null && owner.addressLng != null
        ? { lat: owner.addressLat, lng: owner.addressLng, note: owner.addressNote }
        : null,
    // Highest GPS seq stored — the walker app resumes numbering after it.
    lastSeq: lastPoint?.seq ?? -1,
    booking: w.booking
      ? bookingContextOf(w.booking, zones.get(w.booking.zoneId) ?? null)
      : null,
  };
}

/**
 * Geofence for start/end: the walker must be within `tracking.geofenceMeters`
 * of the owner's address, unless an admin left an override for this phase.
 * Returns the distance to record (null when unknown) and the override used.
 */
function checkGeofence(
  walk: FullWalk,
  phase: "start" | "end",
  pos: Position | null,
  cfg: AppConfig
): { distance: number | null; override: string | null } {
  const override = phase === "start" ? walk.startOverride : walk.endOverride;
  const owner = walk.booking?.owner;
  const pickup =
    owner?.addressLat != null && owner.addressLng != null
      ? { lat: owner.addressLat, lng: owner.addressLng }
      : null;
  const distance = pos && pickup ? Math.round(geofenceDistance(pos, pickup).meters) : null;
  if (override) return { distance, override };

  if (!pos) {
    throw new ApiError(400, "Activa la ubicación del teléfono para registrar el paseo.");
  }
  if (pos.mock) {
    throw new ApiError(400, "Desactiva la ubicación simulada del teléfono para continuar.");
  }
  if (!pickup) {
    throw new ApiError(
      400,
      "El dueño no tiene su dirección marcada en el mapa. Pide a soporte que autorice el paseo."
    );
  }
  const radius = cfg.tracking.geofenceMeters;
  if (geofenceDistance(pos, pickup).effective > radius) {
    throw new ApiError(
      400,
      `${phase === "start" ? "Estás demasiado lejos del domicilio del dueño para iniciar el paseo:" : "Estás demasiado lejos del domicilio del dueño para finalizar el paseo:"} ${distance} m / ${radius} m`
    );
  }
  return { distance, override: null };
}

async function auditOverride(actorId: string, walkId: string, phase: "start" | "end", reason: string) {
  await db.auditLog.create({
    data: {
      actorId,
      action: "WALK_GEOFENCE_OVERRIDE_USED",
      entity: "walk",
      entityId: walkId,
      detail: JSON.stringify({ phase, reason }),
    },
  });
}

async function loadWalk(id: string): Promise<FullWalk> {
  const walk = await db.walk.findUnique({ where: { id }, include: walkInclude });
  if (!walk) throw new ApiError(404, "Paseo no encontrado.");
  return walk;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const walk = await loadWalk(id);
    if (walk.ownerId !== user.id && walk.walkerId !== user.id && user.role !== "ADMIN") {
      throw new ApiError(403, "No tienes acceso a este paseo.");
    }
    return ok(await withContext(walk));
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const cfg = await getAppConfig();
    const body = await readJson(req);
    const action = optStr(body, "action");
    if (!action) throw new ApiError(400, "Indica una acción: start, finish o no_show.");

    const walk = await loadWalk(id);
    if (walk.walkerId !== user.id) {
      throw new ApiError(403, "Solo el paseador asignado puede actualizar este paseo.");
    }
    const dogName = walk.dog?.name ?? "el perrito";

    // -----------------------------------------------------------
    // START
    // -----------------------------------------------------------
    if (action === "start") {
      if (walk.status !== "SCHEDULED") {
        throw new ApiError(400, "El paseo no está en estado programado.");
      }
      const now = Date.now();
      if (walk.scheduledStart.getTime() - now > START_WINDOW_MS) {
        throw new ApiError(
          400,
          "Aún no puedes iniciar: el paseo comienza en menos de 60 minutos."
        );
      }
      const pos = positionOf(body);
      const fence = checkGeofence(walk, "start", pos, cfg);
      // Conditional update: two concurrent starts cannot both succeed.
      const started = await db.walk.updateMany({
        where: { id: walk.id, status: "SCHEDULED" },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
          startDistanceM: fence.distance,
          ...(fence.override ? { startOverride: null } : {}),
          ...(pos ? { startLat: pos.lat, startLng: pos.lng } : {}),
          ...(pos?.mock ? { mockLocation: true } : {}),
        },
      });
      if (started.count === 0) throw new ApiError(400, "El paseo no está en estado programado.");
      if (fence.override) await auditOverride(user.id, walk.id, "start", fence.override);
      await notify(
        walk.ownerId,
        "WALK",
        "¡El paseo empezó! 🐾",
        `${user.name} inició el paseo de ${dogName}. Sigue el recorrido en vivo en el mapa.`,
        "walk-live"
      );
      return ok(await withContext(await loadWalk(walk.id)));
    }

    // -----------------------------------------------------------
    // FINISH (track + report + money settlement)
    // -----------------------------------------------------------
    if (action === "finish") {
      if (walk.status !== "IN_PROGRESS") {
        throw new ApiError(400, "Solo puedes finalizar un paseo en curso.");
      }

      // Guardrail: no walk completion without a report card.
      const report = body.report;
      if (typeof report !== "object" || report === null) {
        throw new ApiError(400, "El reporte del paseo es obligatorio (nota, pis/caca, fotos).");
      }
      const rep = report as Record<string, unknown>;
      const note = typeof rep.note === "string" ? rep.note.slice(0, 800) : null;
      const photos = Array.isArray(rep.photos)
        ? rep.photos.filter((p): p is string => typeof p === "string").slice(0, 6)
        : [];

      // Track + distance were built from the uploaded GPS fixes
      // (POST /api/walks/[id]/track); the body cannot change them.
      const pos = positionOf(body);
      const fence = checkGeofence(walk, "end", pos, cfg);
      const now = new Date();

      const finished = await db.walk.updateMany({
        where: { id: walk.id, status: "IN_PROGRESS" },
        data: {
          status: "COMPLETED",
          endedAt: now,
          endDistanceM: fence.distance,
          ...(fence.override ? { endOverride: null } : {}),
          ...(pos ? { endLat: pos.lat, endLng: pos.lng } : {}),
          ...(pos?.mock ? { mockLocation: true } : {}),
        },
      });
      if (finished.count === 0) throw new ApiError(400, "Solo puedes finalizar un paseo en curso.");
      if (fence.override) await auditOverride(user.id, walk.id, "end", fence.override);
      const hasTrack = walk.trackJson !== "[]";

      // Report card upsert
      const existingReport = await db.reportCard.findUnique({ where: { walkId: walk.id } });
      if (existingReport) {
        await db.reportCard.update({
          where: { walkId: walk.id },
          data: {
            note,
            pee: rep.pee === true,
            poo: rep.poo === true,
            water: rep.water === true,
            photosJson: JSON.stringify(photos),
          },
        });
      } else {
        await db.reportCard.create({
          data: {
            walkId: walk.id,
            note,
            pee: rep.pee === true,
            poo: rep.poo === true,
            water: rep.water === true,
            photosJson: JSON.stringify(photos),
          },
        });
      }

      // ---- Money settlement ----
      const payment = await db.payment.findFirst({
        where: { bookingId: walk.bookingId },
        orderBy: { createdAt: "desc" },
      });
      if (payment) {
        await settleCompletedWalk({ payment, walk, dogName, cfg, at: now });
      }

      // ---- Walker counters ----
      if (user.walker) {
        const totalWalks = user.walker.totalWalks + 1;
        await db.walkerProfile.update({
          where: { id: user.walker.id },
          data: {
            totalWalks,
            trialDone: user.walker.trialDone || totalWalks >= cfg.policy.trialWalks,
          },
        });
      }

      // ---- Booking completion + next-cycle payment ----
      const remaining = await db.walk.count({
        where: { bookingId: walk.bookingId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      });
      if (remaining === 0) {
        await db.booking.updateMany({
          where: { id: walk.bookingId, status: "CONFIRMED" },
          data: { status: "COMPLETED", completedAt: now },
        });
      } else {
        await ensurePendingPayment(walk.bookingId);
      }

      const cashAmount = payment?.amountCents ?? walk.booking?.pricePerWalkCents ?? 0;
      await notify(
        walk.ownerId,
        "WALK",
        "Reporte listo 🎉",
        `${user.name} terminó el paseo de ${dogName}${hasTrack ? " con mapa del recorrido" : ""}. Mira las fotos y el reporte completo.${payment?.method === "CASH" ? ` Ten listo ${formatBOB(cashAmount)} en efectivo.` : ""}`,
        "bookings"
      );
      await publishRealtime(`walk:${walk.id}`, "walk:ended", { walkId: walk.id });
      return ok(await withContext(await loadWalk(walk.id)));
    }

    // -----------------------------------------------------------
    // NO_SHOW (walker marks the owner absent at pickup)
    // -----------------------------------------------------------
    if (action === "no_show") {
      if (walk.status !== "SCHEDULED") {
        throw new ApiError(400, "Solo puedes marcar inasistencia en un paseo programado.");
      }
      await db.walk.update({
        where: { id: walk.id },
        data: {
          status: "NO_SHOW",
          cancelReason: "El dueño no se presentó en el punto de encuentro",
        },
      });
      await notify(
        walk.ownerId,
        "WALK",
        "No te encontramos en el punto de encuentro ⚠️",
        `${user.name} esperó a ${dogName} pero no hubo nadie. Si fue un error, escríbele por chat o contáctanos.`,
        "bookings"
      );
      return ok(await withContext(await loadWalk(walk.id)));
    }

    throw new ApiError(400, `Acción desconocida: ${action}`);
  });
}

/** Optional device position in the body ({lat, lng, acc?, mock?}). */
function positionOf(body: Record<string, unknown>): Position | null {
  if (body.lat === undefined && body.lng === undefined) return null;
  const parsed = PositionSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "La ubicación enviada es inválida.");
  return parsed.data;
}
