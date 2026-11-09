// POST /api/walks/[id]/backup {action:"accept"|"decline"} — the walker the
// late walk is currently offered to (backup chain, Milestone 8).

import { z } from "zod";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireWalker } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { acceptBackup, declineBackup } from "@/lib/server/safety/backup";

const Body = z.object({ action: z.enum(["accept", "decline"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireWalker(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, "Indica una acción: accept o decline.");
    const cfg = await getAppConfig();
    if (parsed.data.action === "accept") await acceptBackup(id, user, cfg);
    else await declineBackup(id, user.id, cfg);
    return ok({ ok: true, action: parsed.data.action });
  });
}
