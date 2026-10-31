// POST /api/payments/[id]/qr → PaymentDTO with a live QR (owner only).
// Issues a QR with the payment provider, or renews an expired one. The QR
// amount is the payment's server-side amount; the client sends nothing.

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { paymentOf } from "@/lib/server/serialize";
import { ensureQr } from "@/lib/server/payments/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) throw new ApiError(404, "Pago no encontrado.");
    if (payment.ownerId !== user.id) throw new ApiError(403, "Este pago no es tuyo.");
    if (payment.status === "PENDING" && payment.method !== "QR") {
      await db.payment.update({ where: { id }, data: { method: "QR" } });
    }
    return ok(paymentOf(await ensureQr(id)));
  });
}
