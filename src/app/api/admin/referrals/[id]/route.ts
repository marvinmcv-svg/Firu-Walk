// PATCH /api/admin/referrals/[id] {action: "void", reason} → AdminReferralDTO-lite
// Ops cancels a PENDING referral (same person, fake account, …) before it
// pays out. Rewarded referrals are not undone here (the gifts are already
// in the owners' accounts).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    if (body.action !== "void") throw new ApiError(400, "Acción inválida.");
    const reason = reqStr(body, "reason", "El motivo", { max: 300 });
    const moved = await db.referral.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "VOID", voidReason: reason },
    });
    if (moved.count === 0) {
      const exists = await db.referral.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new ApiError(404, "Invitación no encontrada.");
      throw new ApiError(400, "Solo se pueden anular invitaciones pendientes.");
    }
    await db.auditLog.create({
      data: { actorId: admin.id, action: "REFERRAL_VOIDED", entity: "referral", entityId: id, detail: reason },
    });
    return ok({ id, status: "VOID" });
  });
}
