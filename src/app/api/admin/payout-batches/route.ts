// GET  /api/admin/payout-batches → PayoutBatchDTO[] (latest 12)
// POST /api/admin/payout-batches → PayoutBatchDTO — build a DRAFT batch now
//      (normally the weekly cron does it).

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { batchInclude, batchOf, buildPayoutBatch } from "@/lib/server/payments/payouts";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const batches = await db.payoutBatch.findMany({ include: batchInclude, orderBy: { createdAt: "desc" }, take: 12 });
    return ok(await Promise.all(batches.map(batchOf)));
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const batch = await buildPayoutBatch(admin.id);
    await db.auditLog.create({
      data: { actorId: admin.id, action: "PAYOUT_BATCH_CREATED", entity: "payoutBatch", entityId: batch.id },
    });
    return ok(await batchOf(batch), { status: 201 });
  });
}
