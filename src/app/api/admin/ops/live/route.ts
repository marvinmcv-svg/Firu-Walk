// GET /api/admin/ops/live → OpsLiveDTO: walks in progress (last GPS fix +
// track tail), late walks with backup state, open incidents, job health.

import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { opsLive } from "@/lib/server/safety/ops";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    return ok(await opsLive(await getAppConfig()));
  });
}
