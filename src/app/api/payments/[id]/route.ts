// GET /api/payments/[id] → PaymentDTO (owner of the payment or admin).
// While PENDING with a provider QR, asks the provider for its status first
// (the "status poll" path: a payment the provider reports as paid becomes
// HELD even if its webhook was lost).

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { paymentOf } from "@/lib/server/serialize";
import { pollPayment } from "@/lib/server/payments/service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) throw new ApiError(404, "Pago no encontrado.");
    if (payment.ownerId !== user.id && user.role !== "ADMIN") {
      throw new ApiError(403, "No tienes acceso a este pago.");
    }
    return ok(paymentOf(await pollPayment(payment)));
  });
}
