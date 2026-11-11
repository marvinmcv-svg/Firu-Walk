// PATCH /api/admin/partners/[id] {name?, kind?, referralFeeCents?, giftWalk?, active?, …} → PartnerDTO
// The code never changes (it is printed on flyers); deactivate instead.
// A new fee applies to owners activated from now on.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { appBaseUrl, partnerOf } from "@/lib/server/partners";
import { requireAdmin } from "@/lib/server/session";
import { PartnerInput } from "../schema";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = PartnerInput.partial().safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos del aliado inválidos.");
    if (Object.keys(parsed.data).length === 0) throw new ApiError(400, "No hay cambios válidos que aplicar.");
    if (!(await db.partner.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Aliado no encontrado.");
    const partner = await db.partner.update({ where: { id }, data: parsed.data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "PARTNER_UPDATED", entity: "partner", entityId: id, detail: JSON.stringify(parsed.data) },
    });
    return ok(partnerOf(partner, appBaseUrl(req)));
  });
}
