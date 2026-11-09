// GET /api/walkers/me/vetting → WalkerVettingDTO for the signed-in walker.
// Shows which documents are on file — never the files themselves.

import { ok, run, ApiError } from "@/lib/server/http";
import { requireWalker } from "@/lib/server/session";
import { loadVetting, vettingOf } from "@/lib/server/walkerVetting";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    if (!user.walker) throw new ApiError(404, "No tienes un perfil de paseador.");
    const p = await loadVetting(user.walker.id);
    return ok(vettingOf(p!, p!.documents));
  });
}
