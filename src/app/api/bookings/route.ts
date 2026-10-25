// GET  /api/bookings → BookingDTO[] role-scoped (sweeps expired requests first)
// POST /api/bookings → create REQUESTED booking with candidate chain + PENDING payment

import { db } from "@/lib/db";
import {
  ApiError,
  ok,
  oneOf,
  optStr,
  readJson,
  reqNum,
  run,
} from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { notify } from "@/lib/server/notify";
import { bookingInclude, bookingList, bookingOf } from "@/lib/server/serialize";
import {
  matchWalkers,
  normalizeSchedule,
  priceBandForDuration,
  scheduleSummary,
  sweepExpiredRequests,
  walkerPriceForDuration,
} from "@/lib/server/bookingEngine";
import type { BookingType } from "@/lib/server/bookingEngine";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);

    // CRITICAL: advance expired accept windows before returning state.
    await sweepExpiredRequests();

    const where =
      user.role === "OWNER"
        ? { ownerId: user.id }
        : user.role === "WALKER"
          ? { walkerId: user.id }
          : {};

    const bookings = await db.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { requestedAt: "desc" },
    });
    return ok(await bookingList(bookings));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") {
      throw new ApiError(403, "Solo los dueños pueden crear reservas.");
    }
    const cfg = await getAppConfig();
    const body = await readJson(req);

    // --- validate payload ---
    const dogId = optStr(body, "dogId");
    if (!dogId) throw new ApiError(400, "Selecciona la mascota para el paseo.");
    const dog = await db.dog.findUnique({ where: { id: dogId } });
    if (!dog) throw new ApiError(404, "La mascota no existe.");
    if (dog.ownerId !== user.id) throw new ApiError(403, "Esta mascota no es tuya.");

    const zoneId = optStr(body, "zoneId");
    if (!zoneId) throw new ApiError(400, "Selecciona la zona del paseo.");
    const zone = await db.zone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.active) throw new ApiError(400, "La zona seleccionada no está disponible.");

    const type = oneOf(body.type, ["ONE_OFF", "RECURRING"] as const, "El tipo de reserva") as BookingType;
    const durationMin = reqNum(body, "durationMin", "La duración", { min: 30, max: 60 });
    if (![30, 45, 60].includes(durationMin)) {
      throw new ApiError(400, "La duración debe ser de 30, 45 o 60 minutos.");
    }
    const schedule = normalizeSchedule(type, body.schedule);
    const paymentMethod = oneOf(body.paymentMethod, ["QR", "TRANSFER", "CASH"] as const, "El método de pago");
    const notes = optStr(body, "notes", { max: 500 }) ?? null;
    const preferredWalkerUserId = optStr(body, "preferredWalkerUserId") ?? null;

    // --- pricing: preferred walker's band, else config band ---
    let pricePerWalkCents = priceBandForDuration(cfg, durationMin);
    let preferredProfile: { id: string; userId: string; status: string; price30Cents: number; price45Cents: number; price60Cents: number } | null = null;
    if (preferredWalkerUserId) {
      preferredProfile = await db.walkerProfile.findUnique({
        where: { userId: preferredWalkerUserId },
      });
      if (!preferredProfile || preferredProfile.status !== "ACTIVE") {
        throw new ApiError(400, "El paseador elegido no está disponible actualmente.");
      }
      pricePerWalkCents = walkerPriceForDuration(preferredProfile, durationMin);
    }

    // --- candidate chain (anti-shotgun: one at a time, max 4 ranked) ---
    const matched = await matchWalkers({ zoneId, durationMin, schedule });
    let candidates: string[];
    if (preferredWalkerUserId) {
      candidates = [
        preferredWalkerUserId,
        ...matched.map((c) => c.userId).filter((id) => id !== preferredWalkerUserId),
      ];
    } else {
      candidates = matched.map((c) => c.userId);
      if (candidates.length === 0) {
        throw new ApiError(
          400,
          "No encontramos paseadores disponibles en esta zona por el momento. Prueba con otro horario o zona."
        );
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + cfg.demo.acceptTimeoutSeconds * 1000);

    const booking = await db.booking.create({
      data: {
        ownerId: user.id,
        dogId: dog.id,
        walkerId: candidates[0],
        zoneId: zone.id,
        type,
        status: "REQUESTED",
        scheduleJson: JSON.stringify(schedule),
        durationMin,
        pricePerWalkCents,
        candidatesJson: JSON.stringify(candidates),
        candidateIdx: 0,
        requestedAt: now,
        expiresAt,
        notes,
      },
    });

    await db.payment.create({
      data: {
        bookingId: booking.id,
        ownerId: user.id,
        walkerId: candidates[0],
        method: paymentMethod,
        amountCents: pricePerWalkCents,
        status: "PENDING",
      },
    });

    // Notify the first candidate (one-at-a-time request)
    const summary = scheduleSummary(schedule, type);
    await notify(
      candidates[0],
      "BOOKING",
      "Nueva solicitud de reserva ⏳",
      `${user.name} solicita paseos para ${dog.name} en ${zone.name} (${summary}, ${durationMin} min). Tienes ${cfg.demo.acceptTimeoutSeconds} segundos para aceptar.`,
      "home"
    );

    const full = await db.booking.findUnique({ where: { id: booking.id }, include: bookingInclude });
    if (!full) throw new ApiError(500, "No se pudo crear la reserva.");
    return ok(bookingOf(full, { id: zone.id, name: zone.name, key: zone.key }), { status: 201 });
  });
}
