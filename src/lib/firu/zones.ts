// Zone labels: once FiruWalk is in more than one city, a zone name alone is
// ambiguous, so pickers add the city ("Sopocachi · La Paz").

import type { ZoneDTO } from "./types";

export function zoneLabel(z: Pick<ZoneDTO, "name" | "city" | "cityId">, all: Pick<ZoneDTO, "cityId">[] | undefined): string {
  const multi = new Set((all ?? []).map((x) => x.cityId)).size > 1;
  return multi ? `${z.name} · ${z.city.split(" de la ")[0]}` : z.name;
}
