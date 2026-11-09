// GET /api/admin/ops/leaderboard?days=30 → LeaderboardRowDTO[]
// (on-time %, rating, no-shows, SOS count per walker).

import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { leaderboard } from "@/lib/server/safety/ops";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const raw = Number(new URL(req.url).searchParams.get("days") ?? 30);
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
    return ok(await leaderboard(await getAppConfig(), days));
  });
}
