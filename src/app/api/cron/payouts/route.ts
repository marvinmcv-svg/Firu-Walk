// GET /api/cron/payouts (CRON_SECRET) — Monday morning: build the weekly DRAFT
// payout batch for admins to approve. Skips quietly when one is still open.

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { notifyAdmins } from "@/lib/server/notify";
import { formatBOB } from "@/lib/firu/money";
import { buildPayoutBatch } from "@/lib/server/payments/payouts";
import { requireCron } from "../auth";

export async function GET(req: Request) {
  return run(async () => {
    requireCron(req);
    try {
      const batch = await buildPayoutBatch(null);
      await db.auditLog.create({
        data: { actorId: null, action: "PAYOUT_BATCH_CREATED", entity: "payoutBatch", entityId: batch.id, detail: "cron" },
      });
      await notifyAdmins(
        "PAYOUT",
        "Lote de pagos listo 💸",
        `${batch.payouts.length} pagos por ${formatBOB(batch.totalCents)} esperan tu aprobación.`,
        "payments"
      );
      return ok({ batchId: batch.id, payouts: batch.payouts.length, totalCents: batch.totalCents });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return ok({ skipped: err.message });
      throw err;
    }
  });
}
