// Booking engine — rules-based matching (one-at-a-time, anti-shotgun),
// walk materialization, accept-timeout sweep and candidate-chain fallback.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppConfig } from "./config";
import { ApiError } from "./http";
import { notify } from "./notify";
import { DAY_ES, dateAtLocalMinute, nextOccurrences } from "./botime";
import { parseJson, walkerCardOf } from "./serialize";
import type { AppConfig, ScheduleItem, WalkerCardDTO } from "@/lib/firu/types";

export const MAX_CANDIDATES = 4;
export const MATCH_TOLERANCE_MIN = 60; // ±60 min availability tolerance

export type BookingType = "ONE_OFF" | "RECURRING";

/** A schedule item normalized to a BO-local weekday + minute (date kept for one-offs). */
export interface NormItem {
  day: number;
  minute: number;
  date?: string;
}

// ---------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------

/**
 * Validate + normalize the raw `schedule` payload.
 * RECURRING: [{day:0-6, minute:0-1439}] — ONE_OFF: [{date:"YYYY-MM-DD", minute}].
 * Rejects past one-off dates.
 */
export function normalizeSchedule(type: BookingType, raw: unknown): ScheduleItem[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 7) {
    throw new ApiError(400, "El horario debe tener entre 1 y 7 bloques.");
  }
  const seen = new Set<string>();
  const out: ScheduleItem[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new ApiError(400, "Horario inválido.");
    }
    const obj = item as Record<string, unknown>;
    const minute = obj.minute;
    if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 1439) {
      throw new ApiError(400, "La hora del paseo es inválida (minutos 0–1439).");
    }
    if (type === "RECURRING") {
      const day = obj.day;
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
        throw new ApiError(400, "El día de la semana es inválido (0=domingo … 6=sábado).");
      }
      const key = `${day}-${minute}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ day, minute });
    } else {
      const date = obj.date;
      if (typeof date !== "string" || !dateAtLocalMinute(date, minute)) {
        throw new ApiError(400, "La fecha del paseo es inválida (formato AAAA-MM-DD).");
      }
      if ((dateAtLocalMinute(date, minute) as Date).getTime() < Date.now()) {
        throw new ApiError(400, "No puedes reservar un paseo en una fecha pasada.");
      }
      const key = `${date}-${minute}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ date, minute });
    }
  }
  if (out.length === 0) throw new ApiError(400, "El horario no puede estar vacío.");
  return out;
}

/** BO-local weekday for each schedule item (one-offs resolve their real weekday). */
export function scheduleDays(schedule: ScheduleItem[]): { day: number; minute: number }[] {
  return schedule.map((s) => {
    if (typeof s.day === "number") return { day: s.day, minute: s.minute };
    const d = s.date ? dateAtLocalMinute(s.date, s.minute) : null;
    const day = d ? new Date(d.getTime() - 4 * 3600000).getUTCDay() : 1;
    return { day, minute: s.minute };
  });
}

/** Human summary for notifications: "lun/mié/vie 07:30" or "25/10 17:00". */
export function scheduleSummary(schedule: ScheduleItem[], type: BookingType): string {
  if (type === "RECURRING") {
    const byMinute = new Map<number, number[]>();
    for (const s of schedule) {
      if (typeof s.day !== "number") continue;
      const arr = byMinute.get(s.minute) ?? [];
      arr.push(s.day);
      byMinute.set(s.minute, arr);
    }
    return [...byMinute.entries()]
      .map(([minute, days]) => {
        const hh = `${Math.floor(minute / 60)}`.padStart(2, "0");
        const mm = `${minute % 60}`.padStart(2, "0");
        const dayStr = [...days].sort((a, b) => a - b).map((d) => DAY_ES[d]).join("/");
        return `${dayStr} ${hh}:${mm}`;
      })
      .join(" · ");
  }
  return schedule
    .map((s) => {
      const hh = `${Math.floor(s.minute / 60)}`.padStart(2, "0");
      const mm = `${s.minute % 60}`.padStart(2, "0");
      return `${(s.date ?? "").slice(5).replace("-", "/")} ${hh}:${mm}`;
    })
    .join(" · ");
}

// ---------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------

/**
 * Rules-based ranking: same-zone ACTIVE walkers available for ALL requested
 * dayOfWeeks (AvailabilitySlot covers [minute, minute+duration] with ±60 min
 * tolerance), sorted by rating desc → repeatOwners desc → responseMinutes asc.
 * NEVER returns more than MAX_CANDIDATES (anti-shotgun).
 */
export async function matchWalkers(input: {
  zoneId: string;
  durationMin: number;
  schedule: ScheduleItem[];
  excludeWalkerUserIds?: string[];
}): Promise<WalkerCardDTO[]> {
  const days = scheduleDays(input.schedule);
  const profiles = await db.walkerProfile.findMany({
    where: {
      status: "ACTIVE",
      zoneId: input.zoneId,
      ...(input.excludeWalkerUserIds?.length
        ? { userId: { notIn: input.excludeWalkerUserIds } }
        : {}),
    },
    include: { user: { include: { zone: true } }, zone: true },
  });

  // Fetch availabilities once for the shortlist
  const shortlist = profiles;
  const slots = await db.availabilitySlot.findMany({
    where: { walkerId: { in: shortlist.map((p) => p.id) } },
  });
  const slotsByWalker = new Map<string, typeof slots>();
  for (const s of slots) {
    const arr = slotsByWalker.get(s.walkerId) ?? [];
    arr.push(s);
    slotsByWalker.set(s.walkerId, arr);
  }

  const candidates = shortlist
    .filter((p) => {
      const walkerSlots = slotsByWalker.get(p.id) ?? [];
      // every requested day must be covered by some slot (±tolerance)
      return days.every(({ day, minute }) =>
        walkerSlots.some(
          (s) =>
            s.dayOfWeek === day &&
            s.startMinute - MATCH_TOLERANCE_MIN <= minute &&
            minute + input.durationMin <= s.endMinute + MATCH_TOLERANCE_MIN
        )
      );
    })
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        b.repeatOwners - a.repeatOwners ||
        a.responseMinutes - b.responseMinutes
    )
    .slice(0, MAX_CANDIDATES);

  return candidates.map((p) =>
    walkerCardOf(p.user, p, p.zone?.name ?? p.user.zone?.name ?? "")
  );
}

// ---------------------------------------------------------------------
// Geo helper (walk finish fallback distance)
// ---------------------------------------------------------------------

/** Total length in meters of a [[lat,lng],…] polyline (haversine, integer-safe). */
export function polylineDistanceMeters(track: [number, number][]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    const [lat1, lng1] = track[i - 1];
    const [lat2, lng2] = track[i];
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(a));
  }
  return Math.round(total);
}

// ---------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------

export function priceBandForDuration(cfg: AppConfig, durationMin: number): number {
  if (durationMin <= 30) return cfg.pricing.price30Cents;
  if (durationMin <= 45) return cfg.pricing.price45Cents;
  return cfg.pricing.price60Cents;
}

export function walkerPriceForDuration(
  p: { price30Cents: number; price45Cents: number; price60Cents: number },
  durationMin: number
): number {
  if (durationMin <= 30) return p.price30Cents;
  if (durationMin <= 45) return p.price45Cents;
  return p.price60Cents;
}

// ---------------------------------------------------------------------
// Walk materialization
// ---------------------------------------------------------------------

/**
 * Create the Walk rows for a booking from its schedule.
 * RECURRING → next 4 occurrences of each day/minute combo.
 * ONE_OFF  → the date at minute (past dates skipped).
 * Deletes existing SCHEDULED walks first (accept/reschedule rebuild).
 * `walkerId` must be set (accepting/confirmed walker).
 */
export async function materializeWalks(
  booking: {
    id: string;
    ownerId: string;
    dogId: string;
    zoneId: string;
    walkerId: string | null;
    type: string;
    scheduleJson: string;
    durationMin: number;
  },
  opts?: { onlyFuture?: boolean }
): Promise<number> {
  const walkerId = booking.walkerId;
  if (!walkerId) return 0;
  const schedule = parseJson<ScheduleItem[]>(booking.scheduleJson, []);
  const now = new Date();

  const dates: Date[] = [];
  if (booking.type === "RECURRING") {
    for (const s of schedule) {
      if (typeof s.day !== "number") continue;
      dates.push(...nextOccurrences(s.day, s.minute, 4, now));
    }
  } else {
    for (const s of schedule) {
      if (!s.date) continue;
      const d = dateAtLocalMinute(s.date, s.minute);
      if (d && d.getTime() > now.getTime()) dates.push(d);
    }
  }
  dates.sort((a, b) => a.getTime() - b.getTime());

  await db.walk.deleteMany({
    where: {
      bookingId: booking.id,
      status: "SCHEDULED",
      ...(opts?.onlyFuture ? { scheduledStart: { gt: now } } : {}),
    },
  });

  if (dates.length === 0) return 0;

  await db.walk.createMany({
    data: dates.map((d) => ({
      bookingId: booking.id,
      walkerId,
      ownerId: booking.ownerId,
      dogId: booking.dogId,
      zoneId: booking.zoneId,
      status: "SCHEDULED",
      scheduledStart: d,
      durationMin: booking.durationMin,
    })),
  });
  return dates.length;
}

/** Cancel every remaining SCHEDULED walk of a booking (owner/walker cancel). */
export async function cancelFutureWalks(bookingId: string, reason: string): Promise<number> {
  const res = await db.walk.updateMany({
    where: { bookingId, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelReason: reason },
  });
  return res.count;
}

/**
 * Recurring bookings settle per walk: after a settlement, ensure a fresh
 * PENDING payment exists for the next walk (same method, same price).
 */
export async function ensurePendingPayment(bookingId: string): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true, walks: { where: { status: "SCHEDULED" } } },
  });
  if (!booking) return;
  if (booking.walks.length === 0) return; // nothing left to pay for
  const hasPending = booking.payments.some((p) => p.status === "PENDING");
  if (hasPending) return;
  const last = [...booking.payments].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];
  await db.payment.create({
    data: {
      bookingId: booking.id,
      ownerId: booking.ownerId,
      walkerId: booking.walkerId ?? "",
      method: last?.method ?? "QR",
      amountCents: booking.pricePerWalkCents,
      status: "PENDING",
    },
  });
}

// ---------------------------------------------------------------------
// Accept-timeout sweep + candidate chain fallback
// ---------------------------------------------------------------------

/**
 * Advance a REQUESTED booking to its next candidate. Chain exhausted →
 * DECLINED + notify owner. Returns the updated booking row.
 * Idempotent: callers re-check expiresAt afterwards.
 */
export async function advanceCandidate(bookingId: string): Promise<Prisma.BookingGetPayload<Record<never, never>> | null> {
  const cfg = await getAppConfig();
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { dog: true, owner: true },
  });
  if (!booking || booking.status !== "REQUESTED") return booking;
  const zone = await db.zone.findUnique({ where: { id: booking.zoneId } });

  const candidates = parseJson<string[]>(booking.candidatesJson, []);
  const nextIdx = booking.candidateIdx + 1;

  if (nextIdx >= candidates.length) {
    const updated = await db.booking.update({
      where: { id: booking.id },
      data: { status: "DECLINED", expiresAt: null },
    });
    await notify(
      booking.ownerId,
      "BOOKING",
      "No encontramos paseador 😔",
      `Ningún paseador pudo tomar la reserva de ${booking.dog?.name ?? "tu perrito"} en ${zone?.name ?? "tu zona"}. Prueba con otro horario o zona, o escríbenos por WhatsApp.`,
      "bookings"
    );
    return updated;
  }

  const updated = await db.booking.update({
    where: { id: booking.id },
    data: {
      candidateIdx: nextIdx,
      walkerId: candidates[nextIdx],
      expiresAt: new Date(Date.now() + cfg.demo.acceptTimeoutSeconds * 1000),
    },
  });
  // Open payments follow the new candidate so settlement pays the right walker.
  await db.payment.updateMany({
    where: { bookingId: booking.id, status: { in: ["PENDING", "HELD"] } },
    data: { walkerId: candidates[nextIdx] },
  });

  const summary = scheduleSummary(
    parseJson<ScheduleItem[]>(booking.scheduleJson, []),
    booking.type as BookingType
  );
  await notify(
    candidates[nextIdx],
    "BOOKING",
    "Nueva solicitud de reserva ⏳",
    `${booking.owner?.name ?? "Un dueño"} solicita paseos para ${booking.dog?.name ?? "su perrito"} (${summary}, ${booking.durationMin} min). Tienes ${cfg.demo.acceptTimeoutSeconds} segundos para aceptar.`,
    "home"
  );
  return updated;
}

/**
 * Idempotent sweep: every REQUESTED booking whose accept window expired moves
 * to the next candidate (with a fresh window) or DECLINES when the chain is
 * exhausted. Called from GET /api/bookings, GET/PATCH /api/bookings/[id].
 */
export async function sweepExpiredRequests(): Promise<void> {
  const now = new Date();
  const expired = await db.booking.findMany({
    where: { status: "REQUESTED", expiresAt: { lt: now } },
    select: { id: true },
    take: 50,
  });
  for (const b of expired) {
    // advance until the window is in the future again or the chain is done
    for (let guard = 0; guard < 12; guard++) {
      const cur = await db.booking.findUnique({
        where: { id: b.id },
        select: { status: true, expiresAt: true },
      });
      if (!cur || cur.status !== "REQUESTED") break;
      if (cur.expiresAt && cur.expiresAt.getTime() > Date.now()) break;
      await advanceCandidate(b.id);
    }
  }
}
