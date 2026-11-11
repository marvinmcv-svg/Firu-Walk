// Group walks (Phase 3): one walker, 2–3 compatible dogs, one route.
//
//   walker opens a GroupSlot (zone, time, capacity, allowed sizes)
//     → owners join with one dog each: an ordinary CONFIRMED one-off Booking
//       + Walk (groupSlotId) + PENDING Payment at the group price per dog
//     → the walker picks each dog up at its door (normal start, geofenced),
//       walks them together (GPS fan-out in the track route) and drops each
//       one off (normal finish + its own report card)
//     → settlement uses the booking's commissionPct so the walker keeps
//       walkerPerDogCents of each dog's price.
//
// Owners leave through the normal booking cancel (late-cancel rules apply);
// a walker cancelling the whole slot refunds everyone in full.

import type { DogSize, GroupSlot, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatBOB, priceBreakdown } from "@/lib/firu/money";
import type { AppConfig, GroupSlotDTO } from "@/lib/firu/types";
import { boDateKey, dateAtLocalMinute, BO_OFFSET_MS } from "./botime";
import { cancelFutureWalks } from "./bookingEngine";
import { getAppConfig } from "./config";
import { ApiError } from "./http";
import { notify } from "./notify";
import { assertNotDebtBlocked } from "./payments/debt";
import { settleCancellation } from "./payments/settle";
import { parseJson } from "./serialize";

const ACTIVE_BOOKING = ["REQUESTED", "CONFIRMED", "COMPLETED"] as const;
const MAX_DAYS_AHEAD = 14;
const SIZES: DogSize[] = ["S", "M", "L"];

/** Commission that leaves the walker exactly walkerPerDogCents of the price. */
export function groupCommissionPct(slot: Pick<GroupSlot, "pricePerDogCents" | "walkerPerDogCents">): number {
  if (slot.pricePerDogCents <= 0) return 0;
  return ((slot.pricePerDogCents - slot.walkerPerDogCents) * 100) / slot.pricePerDogCents;
}

export const slotInclude = {
  bookings: {
    where: { status: { in: [...ACTIVE_BOOKING] } },
    include: {
      dog: { select: { id: true, name: true, size: true, breed: true, photoUrl: true } },
      owner: { select: { id: true, name: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, method: true } },
    },
    orderBy: { requestedAt: "asc" },
  },
} satisfies Prisma.GroupSlotInclude;
type FullSlot = Prisma.GroupSlotGetPayload<{ include: typeof slotInclude }>;

/** DTO for a viewer: walkers/admins see the dogs; owners only their own bookings. */
export async function slotsOf(slots: FullSlot[], cfg: AppConfig, viewer: { id: string; role: string }): Promise<GroupSlotDTO[]> {
  const [walkers, zones] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...new Set(slots.map((s) => s.walkerId))] } },
      select: { id: true, name: true, avatarUrl: true, walker: { select: { rating: true, totalWalks: true } } },
    }),
    db.zone.findMany({ where: { id: { in: [...new Set(slots.map((s) => s.zoneId))] } }, select: { id: true, name: true } }),
  ]);
  const walkerBy = new Map(walkers.map((w) => [w.id, w]));
  const zoneBy = new Map(zones.map((z) => [z.id, z]));
  return slots.map((s) => {
    const w = walkerBy.get(s.walkerId);
    const price = priceBreakdown(s.pricePerDogCents, cfg.fees.ownerFeePct);
    const insider = viewer.role === "ADMIN" || viewer.id === s.walkerId;
    const taken = s.bookings.length;
    return {
      id: s.id,
      walker: { id: s.walkerId, name: w?.name ?? "—", avatarUrl: w?.avatarUrl ?? null, rating: w?.walker?.rating ?? null, totalWalks: w?.walker?.totalWalks ?? 0 },
      zone: { id: s.zoneId, name: zoneBy.get(s.zoneId)?.name ?? "—" },
      startsAt: s.startsAt.toISOString(),
      durationMin: s.durationMin,
      capacity: s.capacity,
      taken,
      spotsLeft: Math.max(0, s.capacity - taken),
      sizes: parseJson<DogSize[]>(s.sizesJson, SIZES),
      pricePerDogCents: s.pricePerDogCents,
      ownerFeeCents: price.ownerFeeCents,
      totalPerDogCents: price.totalCents,
      walkerPerDogCents: insider ? s.walkerPerDogCents : null,
      status: s.status,
      note: s.note,
      joinable: s.status === "OPEN" && taken < s.capacity && s.startsAt.getTime() - Date.now() > cfg.groupWalks.joinCloseMinutes * 60_000,
      dogs: insider
        ? s.bookings.map((b) => ({
            bookingId: b.id,
            dogName: b.dog.name,
            size: b.dog.size,
            ownerName: b.owner.name,
            paymentStatus: b.payments[0]?.status ?? null,
            paymentMethod: b.payments[0]?.method ?? null,
          }))
        : [],
      myBookingIds: s.bookings.filter((b) => b.ownerId === viewer.id).map((b) => b.id),
    };
  });
}

/** Walker opens a group slot. */
export async function createSlot(
  walker: { id: string; walker: { status: string; zoneId: string; trialDone: boolean } | null },
  input: { date: string; minute: number; capacity: number; sizes?: DogSize[]; note?: string | null }
): Promise<GroupSlot> {
  const cfg = await getAppConfig();
  const g = cfg.groupWalks;
  if (!g.enabled) throw new ApiError(400, "Los paseos grupales no están activos por el momento.");
  const profile = walker.walker;
  if (!profile || profile.status !== "ACTIVE") throw new ApiError(403, "Solo los paseadores activos pueden ofrecer paseos grupales.");
  if (!profile.trialDone) {
    throw new ApiError(403, "Completa tus paseos de prueba antes de ofrecer paseos grupales.");
  }
  await assertNotDebtBlocked(walker.id, cfg, "self");

  const startsAt = dateAtLocalMinute(input.date, input.minute);
  if (!startsAt || !Number.isInteger(input.minute) || input.minute < 0 || input.minute >= 24 * 60) {
    throw new ApiError(400, "La fecha u hora del paseo grupal es inválida.");
  }
  const now = Date.now();
  if (startsAt.getTime() - now < g.joinCloseMinutes * 60_000 + 30 * 60_000) {
    throw new ApiError(400, "Publica el paseo grupal con más anticipación para que los dueños alcancen a unirse.");
  }
  if (startsAt.getTime() - now > MAX_DAYS_AHEAD * 86_400_000) {
    throw new ApiError(400, `Puedes publicar paseos grupales hasta ${MAX_DAYS_AHEAD} días antes.`);
  }
  const maxDogs = Math.min(4, Math.max(2, g.maxDogs));
  if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > maxDogs) {
    throw new ApiError(400, "Ese número de perros no está permitido para un paseo grupal.");
  }
  const sizes = [...new Set(input.sizes?.length ? input.sizes : SIZES)].filter((s) => SIZES.includes(s));
  if (sizes.length === 0) throw new ApiError(400, "Elige al menos un tamaño de perro.");

  // No overlapping group slots for the same walker.
  const windowMs = g.durationMin * 60_000;
  const clash = await db.groupSlot.findFirst({
    where: {
      walkerId: walker.id,
      status: "OPEN",
      startsAt: { gt: new Date(startsAt.getTime() - windowMs), lt: new Date(startsAt.getTime() + windowMs) },
    },
    select: { id: true },
  });
  if (clash) throw new ApiError(400, "Ya tienes un paseo grupal en ese horario.");

  return db.groupSlot.create({
    data: {
      walkerId: walker.id,
      zoneId: profile.zoneId,
      startsAt,
      durationMin: g.durationMin,
      capacity: input.capacity,
      sizesJson: JSON.stringify(sizes),
      pricePerDogCents: g.pricePerDogCents,
      walkerPerDogCents: Math.min(g.walkerPerDogCents, g.pricePerDogCents),
      note: input.note?.trim() || null,
    },
  });
}

/** Owner joins with one dog → CONFIRMED booking + walk + PENDING payment. Returns the booking id. */
export async function joinSlot(
  owner: { id: string; name: string },
  slotId: string,
  input: { dogId: string; paymentMethod: "QR" | "TRANSFER" | "CASH"; notes?: string | null }
): Promise<string> {
  const cfg = await getAppConfig();
  if (!cfg.groupWalks.enabled) throw new ApiError(400, "Los paseos grupales no están activos por el momento.");
  const dog = await db.dog.findUnique({ where: { id: input.dogId } });
  if (!dog) throw new ApiError(404, "La mascota no existe.");
  if (dog.ownerId !== owner.id) throw new ApiError(403, "Esta mascota no es tuya.");
  if (dog.temperament === "ANXIOUS") {
    throw new ApiError(400, "Por seguridad, los perros ansiosos o reactivos pasean solos. Reserva un paseo individual.");
  }

  const result = await db.$transaction(async (tx) => {
    // Lock the slot: joins are serialized so it can never overfill.
    await tx.$queryRaw`SELECT id FROM "GroupSlot" WHERE id = ${slotId} FOR UPDATE`;
    const slot = await tx.groupSlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.status !== "OPEN") throw new ApiError(404, "Ese paseo grupal ya no está disponible.");
    if (slot.walkerId === owner.id) throw new ApiError(400, "No puedes unirte a tu propio paseo grupal.");
    if (slot.startsAt.getTime() - Date.now() <= cfg.groupWalks.joinCloseMinutes * 60_000) {
      throw new ApiError(400, "Las inscripciones de este paseo grupal ya cerraron.");
    }
    const sizes = parseJson<DogSize[]>(slot.sizesJson, SIZES);
    if (!sizes.includes(dog.size)) throw new ApiError(400, "Este paseo grupal no es para perros de ese tamaño.");
    const current = await tx.booking.findMany({
      where: { groupSlotId: slot.id, status: { in: [...ACTIVE_BOOKING] } },
      select: { dogId: true },
    });
    if (current.some((b) => b.dogId === dog.id)) throw new ApiError(400, `${dog.name} ya está en este paseo grupal.`);
    if (current.length >= slot.capacity) throw new ApiError(400, "Este paseo grupal ya está completo.");

    const now = new Date();
    const local = new Date(slot.startsAt.getTime() - BO_OFFSET_MS);
    const booking = await tx.booking.create({
      data: {
        ownerId: owner.id,
        dogId: dog.id,
        walkerId: slot.walkerId,
        zoneId: slot.zoneId,
        type: "ONE_OFF",
        status: "CONFIRMED",
        scheduleJson: JSON.stringify([
          { date: boDateKey(slot.startsAt), minute: local.getUTCHours() * 60 + local.getUTCMinutes() },
        ]),
        durationMin: slot.durationMin,
        pricePerWalkCents: slot.pricePerDogCents,
        candidatesJson: JSON.stringify([slot.walkerId]),
        requestedAt: now,
        acceptedAt: now,
        notes: input.notes?.trim() || null,
        groupSlotId: slot.id,
        commissionPct: groupCommissionPct(slot),
      },
    });
    await tx.walk.create({
      data: {
        bookingId: booking.id,
        walkerId: slot.walkerId,
        ownerId: owner.id,
        dogId: dog.id,
        zoneId: slot.zoneId,
        status: "SCHEDULED",
        scheduledStart: slot.startsAt,
        durationMin: slot.durationMin,
        groupSlotId: slot.id,
      },
    });
    const price = priceBreakdown(slot.pricePerDogCents, cfg.fees.ownerFeePct);
    await tx.payment.create({
      data: {
        bookingId: booking.id,
        ownerId: owner.id,
        walkerId: slot.walkerId,
        method: input.paymentMethod,
        amountCents: price.totalCents,
        ownerFeeCents: price.ownerFeeCents,
        status: "PENDING",
      },
    });
    return { bookingId: booking.id, slot, taken: current.length + 1 };
  });

  await notify(
    result.slot.walkerId,
    "BOOKING",
    "Nuevo perro en tu paseo grupal 🐕",
    `${owner.name.split(" ")[0]} sumó a ${dog.name} a tu paseo grupal (${result.taken}/${result.slot.capacity}).`,
    "home"
  );
  return result.bookingId;
}

/** Walker (or admin) cancels the whole slot: every dog's booking is refunded in full. */
export async function cancelSlot(
  actor: { id: string; role: string; walker: { id: string } | null },
  slotId: string,
  reason: string | null
): Promise<void> {
  const cfg = await getAppConfig();
  const slot = await db.groupSlot.findUnique({ where: { id: slotId } });
  if (!slot) throw new ApiError(404, "Paseo grupal no encontrado.");
  if (actor.role !== "ADMIN" && slot.walkerId !== actor.id) throw new ApiError(403, "Este paseo grupal no es tuyo.");
  const moved = await db.groupSlot.updateMany({
    where: { id: slotId, status: "OPEN" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (moved.count === 0) throw new ApiError(400, "Este paseo grupal ya fue cancelado.");

  const bookings = await db.booking.findMany({
    where: { groupSlotId: slotId, status: { in: ["REQUESTED", "CONFIRMED"] } },
    include: { dog: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const now = new Date();
  // Late notice by the walker counts as a strike, like any walker cancellation.
  const late = slot.startsAt.getTime() - now.getTime() < cfg.policy.cancellationFreeHours * 3_600_000;
  if (late && bookings.length > 0 && actor.role !== "ADMIN" && actor.walker) {
    await db.walkerProfile.update({ where: { id: actor.walker.id }, data: { strikes: { increment: 1 } } });
  }
  for (const b of bookings) {
    await cancelFutureWalks(b.id, "Paseo grupal cancelado");
    const payment = b.payments[0];
    let refund = 0;
    if (payment) {
      // Not "late" from the owner's side: everything goes back to them.
      const r = await settleCancellation({
        payment,
        walkerId: b.walkerId,
        ownerId: b.ownerId,
        bookingId: b.id,
        isLate: false,
        dogName: b.dog.name,
        cfg,
        at: now,
        commissionPct: b.commissionPct,
      });
      refund = r.refundCents;
    }
    await db.booking.update({
      where: { id: b.id },
      data: {
        status: "CANCELLED",
        cancelledBy: actor.role === "ADMIN" ? "ADMIN" : "WALKER",
        cancelledAt: now,
        cancelReason: reason ?? "Paseo grupal cancelado",
      },
    });
    await notify(
      b.ownerId,
      "BOOKING",
      "Paseo grupal cancelado 😔",
      `El paseo grupal de ${b.dog.name} se canceló${reason ? `: «${reason}»` : "."}${refund > 0 ? ` Te devolvemos ${formatBOB(refund)}.` : ""} Puedes reservar un paseo individual o unirte a otro grupo.`,
      "bookings"
    );
  }
}
