// PATCH /api/payouts/[id] (admin)
//   {action:"paid", reference}  REQUESTED|APPROVED → PAID (payout:{id} → platform:cash)
//   {action:"cancel", reason?}  → CANCELLED, money back to the wallet
// Batches usually pay many at once: PATCH /api/admin/payout-batches/[id].

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { payoutOf } from "@/lib/server/serialize";
import { cancelPayout, markPayoutPaid } from "@/lib/server/payments/payouts";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const action = optStr(body, "action");
    if (!action) throw new ApiError(400, "Indica una acción: paid o cancel.");

    let updated;
    if (action === "paid") {
      const reference = optStr(body, "reference", { max: 80 });
      if (!reference || reference.length < 3) {
        throw new ApiError(400, "Indica la referencia de la transferencia.");
      }
      updated = await markPayoutPaid(id, reference, admin.id);
    } else if (action === "cancel") {
      updated = await cancelPayout(id, admin.id, optStr(body, "reason", { max: 200 }) ?? null);
    } else {
      throw new ApiError(400, `Acción desconocida: ${action}`);
    }
    const walker = await db.user.findUnique({ where: { id: updated.walkerId }, select: { name: true } });
    return ok(payoutOf(updated, walker?.name ?? null));
  });
}
