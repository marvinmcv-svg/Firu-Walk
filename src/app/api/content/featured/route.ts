// GET /api/content/featured → PublicFeaturedDTO (no auth; landing page)
// "Firu del mes" and walker spotlights, only while the owner / walker still
// consents. Cached for a minute at most, so a revoked consent drops off fast.

import { ok, run } from "@/lib/server/http";
import { publicFeatured } from "@/lib/server/content";

export async function GET() {
  return run(async () =>
    ok(await publicFeatured(), { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } })
  );
}
