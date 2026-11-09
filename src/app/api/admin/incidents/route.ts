// GET /api/admin/incidents?status=OPEN|RESOLVED|ALL → IncidentDTO[] (queue: open SOS first)

import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { listIncidents } from "@/lib/server/safety/ops";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const raw = new URL(req.url).searchParams.get("status") ?? "OPEN";
    const status = raw === "RESOLVED" || raw === "ALL" ? raw : "OPEN";
    return ok(await listIncidents(status));
  });
}
