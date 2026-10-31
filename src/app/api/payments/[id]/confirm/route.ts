// POST /api/payments/[id]/confirm {reason, reference?} → PaymentDTO (ADMIN only)
// Manual reconciliation: ops saw the money arrive (bank statement, transfer,
// provider dashboard) but the webhook/poll did not record it. Requires a
// reason and leaves an audit log. Owners can no longer confirm their own
// payments — money is confirmed by the provider.

import { db } from "@/lib/db";
import { z } from "zod";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { paymentOf } from "@/lib/server/serialize";
import { markPaid } from "@/lib/server/payments/service";

const Body = z.object({
  reason: z.string().trim().min(5, "Explica el motivo (mínimo 5 caracteres).").max(300),
  reference: z.string().trim().max(80).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    }
    const { reason, reference } = parsed.data;

    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) throw new ApiError(404, "Pago no encontrado.");
    if (payment.status !== "PENDING") throw new ApiError(400, "Este pago ya fue confirmado.");
    if (payment.method === "CASH" || payment.method === "PLAN") {
      throw new ApiError(400, "Los pagos en efectivo o con plan no se confirman manualmente.");
    }

    const res = await markPaid(payment.id, {
      paidCents: payment.amountCents,
      source: "admin",
      method: payment.method,
    });
    if (!res.applied) throw new ApiError(400, "Este pago ya fue confirmado.");
    const updated = reference
      ? await db.payment.update({ where: { id: payment.id }, data: { qrRef: reference } })
      : res.payment;
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "PAYMENT_MANUAL_CONFIRM",
        entity: "payment",
        entityId: payment.id,
        detail: JSON.stringify({ reason, reference: reference ?? null, amountCents: payment.amountCents }),
      },
    });
    return ok(paymentOf(updated));
  });
}
