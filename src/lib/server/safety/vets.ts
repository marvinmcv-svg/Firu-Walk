// Admin-managed vet clinics, nearest first (shown on SOS).

import type { Vet } from "@prisma/client";
import { db } from "@/lib/db";
import type { VetDTO } from "@/lib/firu/types";
import { haversineMeters } from "../tracking";

export function vetOf(v: Vet, from?: { lat: number; lng: number } | null): VetDTO {
  return {
    id: v.id,
    name: v.name,
    phone: v.phone,
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    open24h: v.open24h,
    notes: v.notes,
    active: v.active,
    distanceM: from ? Math.round(haversineMeters(from, v)) : null,
  };
}

/** Active vets sorted by distance (24h clinics first on ties), at most `limit`. */
export async function nearestVets(
  from: { lat: number; lng: number } | null,
  limit = 5
): Promise<VetDTO[]> {
  const vets = await db.vet.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const out = vets.map((v) => vetOf(v, from));
  if (from) out.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || Number(b.open24h) - Number(a.open24h));
  else out.sort((a, b) => Number(b.open24h) - Number(a.open24h));
  return out.slice(0, limit);
}
