// GET /api/cities → CityDTO[] — launched cities with at least one active zone:
// walk lengths, base prices and peak hours per city (public).

import { ok, run } from "@/lib/server/http";
import { activeCities } from "@/lib/server/cities";

export async function GET() {
  return run(async () => ok(await activeCities()));
}
