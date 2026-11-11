// Phase 3 expansion: per-city rules. A zone is usable by owners and walkers
// only while both the zone and its city are active. Each city sets the walk
// lengths it offers, its base prices (defaults for new walkers and for
// bookings without a chosen walker) and its peak hours (zone occupancy).

import type { City, Zone } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/server/http";
import { parseJson } from "@/lib/server/serialize";
import type { AdminCityDTO, CityDTO } from "@/lib/firu/types";

export const ALL_DURATIONS = [30, 45, 60] as const;
export type CityRules = Pick<City, "name" | "price30Cents" | "price45Cents" | "price60Cents" | "durationsJson" | "peakJson">;

/** Walk lengths offered in a city (a valid, sorted subset of 30/45/60). */
export function cityDurations(c: Pick<City, "durationsJson">): number[] {
  const list = parseJson<unknown[]>(c.durationsJson, []);
  const valid = ALL_DURATIONS.filter((d) => list.includes(d));
  return valid.length > 0 ? valid : [...ALL_DURATIONS];
}

/** Peak windows [fromMin, toMin) in local minutes from 00:00. */
export function cityPeaks(c: Pick<City, "peakJson">): [number, number][] {
  const list = parseJson<unknown[]>(c.peakJson, []);
  return list.filter(
    (w): w is [number, number] =>
      Array.isArray(w) && w.length === 2 && w.every((n) => Number.isInteger(n)) && w[0] >= 0 && w[0] < w[1] && w[1] <= 1440
  );
}

export function cityPriceForDuration(c: Pick<City, "price30Cents" | "price45Cents" | "price60Cents">, durationMin: number): number {
  if (durationMin <= 30) return c.price30Cents;
  if (durationMin <= 45) return c.price45Cents;
  return c.price60Cents;
}

/** 400 unless the city offers this walk length. */
export function assertCityDuration(c: CityRules, durationMin: number): void {
  const offered = cityDurations(c);
  if (!offered.includes(durationMin)) {
    throw new ApiError(400, `Duración no disponible en esta ciudad (${offered.join(", ")} min).`);
  }
}

/** The zone with its city, or 400 when either is inactive. */
export async function usableZone(
  zoneId: string,
  message = "La zona seleccionada no está disponible."
): Promise<Zone & { cityRef: City }> {
  const zone = await db.zone.findUnique({ where: { id: zoneId }, include: { cityRef: true } });
  if (!zone || !zone.active || !zone.cityRef.active) throw new ApiError(400, message);
  return zone;
}

export function cityOf(c: City, zoneCount?: number): CityDTO {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    centerLat: c.centerLat,
    centerLng: c.centerLng,
    active: c.active,
    sortOrder: c.sortOrder,
    price30Cents: c.price30Cents,
    price45Cents: c.price45Cents,
    price60Cents: c.price60Cents,
    durations: cityDurations(c),
    peaks: cityPeaks(c),
    ...(zoneCount !== undefined ? { zoneCount } : {}),
  };
}

/** Active cities that have at least one active zone (public). */
export async function activeCities(): Promise<CityDTO[]> {
  const cities = await db.city.findMany({
    where: { active: true },
    include: { _count: { select: { zones: { where: { active: true } } } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return cities.filter((c) => c._count.zones > 0).map((c) => cityOf(c, c._count.zones));
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------

/**
 * Refuse to switch off zones that still have work: walks not finished yet or
 * bookings waiting for a walker. Ops move or cancel those first.
 */
export async function assertNoOpenWork(zoneIds: string[]): Promise<void> {
  if (zoneIds.length === 0) return;
  const [walks, bookings] = await Promise.all([
    db.walk.count({ where: { zoneId: { in: zoneIds }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } }),
    db.booking.count({ where: { zoneId: { in: zoneIds }, status: { in: ["REQUESTED", "CONFIRMED"] } } }),
  ]);
  if (walks + bookings > 0) {
    throw new ApiError(
      400,
      "No se puede desactivar: hay paseos pendientes o reservas abiertas. Cancélalos o reasígnalos primero."
    );
  }
}

/** GET /api/admin/cities — every city with its zones and people counts. */
export async function adminCityList(): Promise<AdminCityDTO[]> {
  const cities = await db.city.findMany({
    include: { zones: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const zoneIds = cities.flatMap((c) => c.zones.map((z) => z.id));
  const [owners, walkers] = await Promise.all([
    db.user.groupBy({ by: ["zoneId"], where: { role: "OWNER", zoneId: { in: zoneIds } }, _count: true }),
    db.walkerProfile.groupBy({ by: ["zoneId"], where: { status: "ACTIVE", zoneId: { in: zoneIds } }, _count: true }),
  ]);
  const ownersBy = new Map(owners.map((o) => [o.zoneId, o._count]));
  const walkersBy = new Map(walkers.map((w) => [w.zoneId, w._count]));
  return cities.map((c) => ({
    ...cityOf(c, c.zones.filter((z) => z.active).length),
    zones: c.zones.map((z) => ({
      id: z.id,
      key: z.key,
      name: z.name,
      centerLat: z.centerLat,
      centerLng: z.centerLng,
      active: z.active,
      sortOrder: z.sortOrder,
      owners: ownersBy.get(z.id) ?? 0,
      walkers: walkersBy.get(z.id) ?? 0,
    })),
  }));
}
