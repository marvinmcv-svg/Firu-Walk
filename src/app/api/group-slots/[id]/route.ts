// PATCH /api/group-slots/[id] {action: "cancel", reason?} → {ok: true}
// The slot's walker (or an admin) cancels the whole group walk: every dog's
// booking is cancelled with a full refund and the owners are told.

import { cancelSlot } from "@/lib/server/groupWalks";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    if (user.role !== "WALKER" && user.role !== "ADMIN") throw new ApiError(403, "Este paseo grupal no es tuyo.");
    const body = await readJson(req);
    if (body.action !== "cancel") throw new ApiError(400, "Acción inválida.");
    await cancelSlot(user, id, optStr(body, "reason", { max: 300 }) ?? null);
    return ok({ ok: true });
  });
}
