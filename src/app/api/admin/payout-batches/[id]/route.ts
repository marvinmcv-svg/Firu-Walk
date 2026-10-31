// PATCH /api/admin/payout-batches/[id]
//   {action:"approve"}                                  DRAFT → APPROVED
//   {action:"paid", reference, references?: {payoutId: ref}}  APPROVED → PAID

import { z } from "zod";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { approveBatch, batchOf, markBatchPaid } from "@/lib/server/payments/payouts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("paid"),
    reference: z.string().trim().min(3, "Indica la referencia de la transferencia.").max(80),
    references: z.record(z.string(), z.string().trim().max(80)).optional(),
  }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Acción inválida: approve o paid.");
    const batch =
      parsed.data.action === "approve"
        ? await approveBatch(id, admin.id)
        : await markBatchPaid(id, admin.id, parsed.data.reference, parsed.data.references);
    return ok(await batchOf(batch));
  });
}
