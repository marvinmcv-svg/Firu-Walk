// GET   /api/bookings/[id] → BookingDTO (participants only; sweeps expired first)
// PATCH /api/bookings/[id] {action:"accept"|"decline"|"cancel"|"reschedule"}
//
// State machine:
//   accept     (walker, REQUESTED & current candidate) → CONFIRMED + materialize walks
//   decline    (walker) → advance candidate chain (or DECLINED + notify owner)
//   cancel     (owner/admin → fee logic per policy; walker → strike + re-request
//              + owner no-show credit)
//   reschedule (owner, CONFIRMED) → replace future SCHEDULED walks

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { notify } from "@/lib/server/notify";
import { postTxn, payerShare } from "@/lib/server/ledger";
import { bookingInclude, bookingOf, parseJson, zonesById } from "@/lib/server/serialize";
import {
  advanceCandidate,
  cancelFutureWalks,
  materializeWalks,
  normalizeSchedule,
  scheduleSummary,
  sweepExpiredRequests,
} from "@/lib/server/bookingEngine";
import type { ScheduleItem } from "@/lib/firu/types";
import type { BookingType } from "@/lib/server/bookingEngine";
import { formatBOB } from "@/lib/firu/money";

async function loadBooking(id: string) {
  const booking = await db.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw new ApiError(404, "Reserva no encontrada.");
  return booking;
}

/** Serialize the current booking state (fetches its zone — no Prisma relation). */
async function serializeCurrent(id: string) {
  const booking = await loadBooking(id);
  const zones = await zonesById([booking.zoneId]);
  return ok(bookingOf(booking, zones.get(booking.zoneId) ?? null));
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    await sweepExpiredRequests();
    const booking = await loadBooking(id);

    const candidates = parseJson<string[]>(booking.candidatesJson, []);
    const visible =
      booking.ownerId === user.id ||
      user.role === "ADMIN" ||
      booking.walkerId === user.id ||
      candidates.includes(user.id);
    if (!visible) throw new ApiError(403, "No tienes acceso a esta reserva.");

    return await serializeCurrent(booking.id);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const cfg = await getAppConfig();
    const body = await readJson(req);

    await sweepExpiredRequests();
    const booking = await loadBooking(id);
    const action = optStr(body, "action");
    if (!action) throw new ApiError(400, "Indica una acción: accept, decline, cancel o reschedule.");

    const dogName = booking.dog?.name ?? "tu perrito";
    const summary = scheduleSummary(
      parseJson<ScheduleItem[]>(booking.scheduleJson, []),
      booking.type as BookingType
    );

    // -----------------------------------------------------------
    // ACCEPT (walker)
    // -----------------------------------------------------------
    if (action === "accept") {
      if (!user.walker) throw new ApiError(403, "Solo los paseadores pueden aceptar reservas.");
      if (booking.status !== "REQUESTED") {
        throw new ApiError(400, "Esta solicitud ya no está disponible.");
      }
      if (booking.walkerId !== user.id) {
        throw new ApiError(403, "Esta solicitud fue enviada a otro paseador.");
      }
      await db.booking.update({
        where: { id: booking.id },
        data: { status: "CONFIRMED", acceptedAt: new Date(), expiresAt: null },
      });
      const fresh = await db.booking.findUnique({ where: { id: booking.id } });
      if (fresh) await materializeWalks(fresh);

      const paymentHint =
        booking.payments.some((p) => p.method === "CASH")
          ? "El pago será en efectivo al finalizar el paseo."
          : "Confirma tu pago (QR o transferencia) para asegurar el primer paseo.";
      await notify(
        booking.ownerId,
        "BOOKING",
        "¡Reserva confirmada! ✅",
        `${user.name} confirmó los paseos de ${dogName} (${summary}). ${paymentHint}`,
        "bookings"
      );
      return await serializeCurrent(booking.id);
    }

    // -----------------------------------------------------------
    // DECLINE (walker, current candidate)
    // -----------------------------------------------------------
    if (action === "decline") {
      if (!user.walker) throw new ApiError(403, "Solo los paseadores pueden responder solicitudes.");
      if (booking.status !== "REQUESTED") {
        throw new ApiError(400, "Esta solicitud ya no está disponible.");
      }
      if (booking.walkerId !== user.id) {
        throw new ApiError(403, "Esta solicitud fue enviada a otro paseador.");
      }
      await advanceCandidate(booking.id);
      return await serializeCurrent(booking.id);
    }

    // -----------------------------------------------------------
    // CANCEL (owner/admin with fee logic; walker with strike + re-request)
    // -----------------------------------------------------------
    if (action === "cancel") {
      if (!["REQUESTED", "CONFIRMED"].includes(booking.status)) {
        throw new ApiError(400, "La reserva ya no se puede cancelar.");
      }
      const reason = optStr(body, "reason", { max: 300 }) ?? null;
      const now = new Date();

      // ---- WALKER cancel: strike + no-show credit + re-request to next candidate
      if (user.role === "WALKER") {
        if (booking.walkerId !== user.id) {
          throw new ApiError(403, "Solo el paseador asignado puede cancelar esta reserva.");
        }
        if (user.walker) {
          await db.walkerProfile.update({
            where: { id: user.walker.id },
            data: { strikes: { increment: 1 } },
          });
        }
        await cancelFutureWalks(booking.id, "El paseador canceló la reserva");

        const noShow = cfg.policy.noShowCreditCents;
        if (noShow > 0) {
          await postTxn(
            [
              {
                account: "platform:revenue",
                debit: noShow,
                memo: `Compensación por cancelación del paseador — ${dogName}`,
              },
              {
                account: `owner:${booking.ownerId}`,
                credit: noShow,
                memo: `Crédito de cortesía por cancelación (${formatBOB(noShow)})`,
              },
            ],
            "booking",
            booking.id
          );
        }

        // Re-request: back to REQUESTED, then advance to the next candidate.
        if (booking.status === "CONFIRMED") {
          await db.booking.update({
            where: { id: booking.id },
            data: { status: "REQUESTED", acceptedAt: null },
          });
        }
        await advanceCandidate(booking.id);
        const after = await db.booking.findUnique({ where: { id: booking.id } });

        if (after?.status === "DECLINED") {
          await db.booking.update({
            where: { id: booking.id },
            data: {
              cancelledBy: "WALKER",
              cancelledAt: now,
              cancelReason: reason ?? "Cancelado por el paseador",
            },
          });
          await notify(
            booking.ownerId,
            "BOOKING",
            "No encontramos un respaldo 😔",
            `${user.name} canceló los paseos de ${dogName} y no quedaron paseadores disponibles en la cadena. Te acreditamos ${formatBOB(noShow)} como compensación.`,
            "bookings"
          );
        } else {
          const nextWalker = after?.walkerId
            ? (await db.user.findUnique({ where: { id: after.walkerId } }))?.name
            : "otro paseador";
          await notify(
            booking.ownerId,
            "BOOKING",
            "Tu paseador canceló ⚠️",
            `${user.name} canceló los paseos de ${dogName}. Ya enviamos tu solicitud a ${nextWalker} y te avisaremos enseguida. Además, te acreditamos ${formatBOB(noShow)} como compensación.`,
            "bookings"
          );
        }
        return await serializeCurrent(booking.id);
      }

      // ---- OWNER / ADMIN cancel with late-cancel fee logic
      if (booking.ownerId !== user.id && user.role !== "ADMIN") {
        throw new ApiError(403, "Solo el dueño o el equipo FiruWalk pueden cancelar esta reserva.");
      }

      const scheduledWalks = booking.walks.filter((w) => w.status === "SCHEDULED");
      const freeHoursMs = cfg.policy.cancellationFreeHours * 3600000;
      const isLate = scheduledWalks.some(
        (w) => w.scheduledStart.getTime() <= now.getTime() + freeHoursMs
      );

      await cancelFutureWalks(booking.id, reason ?? "Cancelado por el dueño");

      // Payment / money handling
      const payment =
        [...booking.payments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
        null;

      if (payment) {
        const gross = payment.amountCents;
        if ((payment.method === "QR" || payment.method === "TRANSFER") && payment.status === "HELD") {
          if (isLate && booking.walkerId) {
            // walker share from held funds; fee split; remainder refunded to owner
            const share = Math.round((gross * cfg.policy.lateCancelWalkerSharePct) / 100);
            const { feeCents, netCents } = payerShare(share, cfg.fees.commissionPct);
            const remainder = gross - share;
            await postTxn(
              [
                { account: "platform:held", debit: share, memo: `Cancelación tardía — parte del paseador (${dogName})` },
                { account: `walker:${booking.walkerId}`, credit: netCents, memo: `Compensación por cancelación tardía (comisión ${cfg.fees.commissionPct}%)` },
                { account: "platform:revenue", credit: feeCents, memo: `Comisión ${cfg.fees.commissionPct}% — cancelación tardía` },
                { account: "platform:held", debit: remainder, memo: `Reembolso al dueño — cancelación (${dogName})` },
                { account: `owner:${booking.ownerId}`, credit: remainder, memo: `Reembolso de ${formatBOB(remainder)} por cancelación` },
              ],
              "booking",
              booking.id,
              now
            );
            await db.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
            if (booking.walkerId) {
              await notify(
                booking.walkerId,
                "PAYMENT",
                "Compensación por cancelación 💛",
                `El dueño canceló el paseo de ${dogName} con poco tiempo. Recibiste ${formatBOB(netCents)} (50% del paseo, neto de comisión).`,
                "earnings"
              );
            }
          } else {
            // free cancel (or no walker yet): full refund from held
            await postTxn(
              [
                { account: "platform:held", debit: gross, memo: `Reembolso total — cancelación (${dogName})` },
                { account: `owner:${booking.ownerId}`, credit: gross, memo: `Reembolso de ${formatBOB(gross)} por cancelación` },
              ],
              "booking",
              booking.id,
              now
            );
            await db.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
          }
        } else if (payment.method === "CASH" && isLate && booking.walkerId) {
          // cash: nothing collected — journal the walker's late-cancel share
          const share = Math.round((gross * cfg.policy.lateCancelWalkerSharePct) / 100);
          const { feeCents, netCents } = payerShare(share, cfg.fees.commissionPct);
          await postTxn(
            [
              { account: `owner:${booking.ownerId}`, debit: share, memo: `Cargo por cancelación tardía (efectivo) — ${dogName}` },
              { account: `walker:${booking.walkerId}`, credit: netCents, memo: `Compensación por cancelación tardía (efectivo)` },
              { account: "platform:revenue", credit: feeCents, memo: `Comisión ${cfg.fees.commissionPct}% — cancelación tardía (efectivo)` },
            ],
            "booking",
            booking.id,
            now
          );
        }
      }

      await db.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELLED",
          cancelledBy: user.role === "ADMIN" ? "ADMIN" : "OWNER",
          cancelledAt: now,
          cancelReason: reason,
        },
      });

      if (booking.walkerId) {
        await notify(
          booking.walkerId,
          "BOOKING",
          "Reserva cancelada",
          `${booking.owner?.name ?? "El dueño"} canceló los paseos de ${dogName}${reason ? `: «${reason}»` : "."} ${isLate ? "Recibirás el 50% del paseo como compensación por el aviso tardío." : ""}`,
          "bookings"
        );
      }
      return await serializeCurrent(booking.id);
    }

    // -----------------------------------------------------------
    // RESCHEDULE (owner, CONFIRMED) — replace future SCHEDULED walks
    // -----------------------------------------------------------
    if (action === "reschedule") {
      if (booking.ownerId !== user.id) {
        throw new ApiError(403, "Solo el dueño puede reprogramar la reserva.");
      }
      if (booking.status !== "CONFIRMED") {
        throw new ApiError(400, "Solo las reservas confirmadas se pueden reprogramar.");
      }
      const schedule = normalizeSchedule(booking.type as BookingType, body.schedule);
      await db.booking.update({
        where: { id: booking.id },
        data: { scheduleJson: JSON.stringify(schedule) },
      });
      const updated = await db.booking.findUnique({ where: { id: booking.id } });
      await materializeWalks(updated!, { onlyFuture: true });

      const newSummary = scheduleSummary(schedule, booking.type as BookingType);
      if (booking.walkerId) {
        await notify(
          booking.walkerId,
          "BOOKING",
          "Reserva reprogramada 📅",
          `${booking.owner?.name ?? "El dueño"} cambió el horario de los paseos de ${dogName}: ${newSummary}.`,
          "bookings"
        );
      }
      return await serializeCurrent(booking.id);
    }

    throw new ApiError(400, `Acción desconocida: ${action}`);
  });
}
