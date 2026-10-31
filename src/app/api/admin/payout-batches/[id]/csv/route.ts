// GET /api/admin/payout-batches/[id]/csv → bank-transfer CSV of the batch.

import { db } from "@/lib/db";
import { ApiError, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { batchCsv } from "@/lib/server/payments/payouts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const batch = await db.payoutBatch.findUnique({ where: { id } });
    if (!batch) throw new ApiError(404, "Lote no encontrado.");
    if (batch.status === "DRAFT") throw new ApiError(400, "Aprueba el lote antes de exportarlo al banco.");
    const csv = await batchCsv(id);
    await db.auditLog.create({
      data: { actorId: admin.id, action: "PAYOUT_BATCH_EXPORTED", entity: "payoutBatch", entityId: id },
    });
    const day = batch.createdAt.toISOString().slice(0, 10);
    return new Response("﻿" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="firuwalk-pagos-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
}
