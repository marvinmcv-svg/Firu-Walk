// GET   /api/walks/[id] → full detail (parsed track, report, booking context)
// PATCH /api/walks/[id] {action:"start"|"finish"|"no_show"} — walker lifecycle:
//   start:  SCHEDULED→IN_PROGRESS (within 60min window) + startLat/Lng
//   finish: IN_PROGRESS→COMPLETED + track + report + money settlement
//   no_show: SCHEDULED→NO_SHOW (owner absent at pickup)

import { db } from "@/lib/db";
import { ApiError, ok, optNum, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { notify } from "@/lib/server/notify";
import { payerShare, postTxn } from "@/lib/server/ledger";
import { formatBOB } from "@/lib/firu/money";
import { ensurePendingPayment, polylineDistanceMeters } from "@/lib/server/bookingEngine";
import { bookingContextOf, walkDetailOf, walkInclude, zonesById } from "@/lib/server/serialize";
import type { FullWalk } from "@/lib/server/serialize";

const START_WINDOW_MS = 60 * 60 * 1000; // may start up to 60 min early

async function withContext(w: FullWalk) {
  const zones = await zonesById(w.booking ? [w.booking.zoneId] : []);
  return {
    ...walkDetailOf(w),
    booking: w.booking
      ? bookingContextOf(w.booking, zones.get(w.booking.zoneId) ?? null)
      : null,
  };
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
      const lat = optNum(body, "lat");
      const lng = optNum(body, "lng");
      await db.walk.update({
        where: { id: walk.id },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
          ...(typeof lat === "number" && typeof lng === "number"
            ? { startLat: lat, startLng: lng }
            : {}),
        },
      });
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

      // Track: replace the polyline + track points with the final route.
      let track: [number, number][] | null = null;
      if (Array.isArray(body.track)) {
        track = (body.track as unknown[])
          .filter(
            (p): p is [number, number] =>
              Array.isArray(p) &&
              p.length >= 2 &&
              typeof p[0] === "number" &&
              typeof p[1] === "number"
          )
          .map((p) => [p[0], p[1]]);
      }
      const distance =
        optNum(body, "distanceMeters") ??
        (track && track.length > 1 ? polylineDistanceMeters(track) : undefined);
      const lat = optNum(body, "lat");
      const lng = optNum(body, "lng");
      const now = new Date();

      await db.walk.update({
        where: { id: walk.id },
        data: {
          status: "COMPLETED",
          endedAt: now,
          ...(distance !== undefined ? { distanceMeters: Math.round(distance) } : {}),
          ...(track
            ? { trackJson: JSON.stringify(track) }
            : {}),
          ...(typeof lat === "number" && typeof lng === "number"
            ? { endLat: lat, endLng: lng }
            : {}),
        },
      });
      if (track) {
        // refresh the point rows so the detail map matches the polyline
        await db.walkTrackPoint.deleteMany({ where: { walkId: walk.id } });
        await db.walkTrackPoint.createMany({
          data: track.map((p, i) => ({
            walkId: walk.id,
            seq: i,
            lat: p[0],
            lng: p[1],
            recordedAt: now,
          })),
        });
      }

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
        const gross = payment.amountCents;
        const { feeCents, netCents } = payerShare(gross, cfg.fees.commissionPct);
        if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "HELD") {
          await postTxn(
            [
              { account: "platform:held", debit: gross, memo: `Liberación — paseo completado (${dogName})` },
              { account: `walker:${walk.walkerId}`, credit: netCents, memo: `Ingreso neto paseo de ${dogName} (comisión ${cfg.fees.commissionPct}%)` },
              { account: "platform:revenue", credit: feeCents, memo: `Comisión ${cfg.fees.commissionPct}% — paseo completado` },
            ],
            "walk",
            walk.id,
            now
          );
          await db.payment.update({
            where: { id: payment.id },
            data: { status: "RELEASED" },
          });
        } else if (payment.method === "CASH" && payment.status === "PENDING") {
          // Cash: fee accrues as a negative wallet entry, owner pays offline.
          await postTxn(
            [
              { account: `walker:${walk.walkerId}`, debit: feeCents, memo: `Comisión ${cfg.fees.commissionPct}% — paseo pagado en efectivo (${dogName})` },
              { account: "platform:revenue", credit: feeCents, memo: `Comisión ${cfg.fees.commissionPct}% — paseo en efectivo` },
            ],
            "walk",
            walk.id,
            now
          );
          await db.payment.update({
            where: { id: payment.id },
            data: { status: "CASH_SETTLED", confirmedAt: now },
          });
        } else if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "PENDING") {
          // Owner never confirmed the QR — remind them (no money moved yet).
          await notify(
            walk.ownerId,
            "PAYMENT",
            "Pago pendiente ⏳",
            `El paseo de ${dogName} terminó, pero tu pago (${payment.method}) sigue pendiente. Confírmalo para que el paseador reciba su ingreso.`,
            "bookings"
          );
        }
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
        `${user.name} terminó el paseo de ${dogName}${track && track.length > 1 ? " con mapa del recorrido" : ""}. Mira las fotos y el reporte completo.${payment?.method === "CASH" ? ` Ten listo ${formatBOB(cashAmount)} en efectivo.` : ""}`,
        "bookings"
      );
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
