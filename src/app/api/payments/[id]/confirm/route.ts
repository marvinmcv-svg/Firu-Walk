// POST /api/payments/[id]/confirm {qrRef?} → PaymentDTO
// Simulates the owner's QR scan / transfer deposit:
// QR/TRANSFER PENDING→HELD + payment.hold txn (owner→platform:held) + notify.

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { postTxn } from "@/lib/server/ledger";
import { notify } from "@/lib/server/notify";
import { paymentOf } from "@/lib/server/serialize";
import { formatBOB } from "@/lib/firu/money";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireUser(req);
    const body = await readJson(req);

    const payment = await db.payment.findUnique({
      where: { id },
      include: { booking: { include: { dog: true } } },
    });
    if (!payment) throw new ApiError(404, "Pago no encontrado.");
    if (payment.ownerId !== user.id && user.role !== "ADMIN") {
      throw new ApiError(403, "Solo el dueño puede confirmar este pago.");
    }
    if (payment.status !== "PENDING") {
      throw new ApiError(400, "Este pago ya fue confirmado.");
    }
    if (payment.method === "CASH") {
      throw new ApiError(
        400,
        "El pago en efectivo no necesita confirmación previa: se entrega al finalizar el paseo."
      );
    }

    const now = new Date();
    const qrRef =
      optStr(body, "qrRef", { max: 40 }) ?? `QR-FW-${payment.id.slice(-6).toUpperCase()}`;

    // Hold txn: money flows owner → platform:held
    await postTxn(
      [
        {
          account: `owner:${payment.ownerId}`,
          debit: payment.amountCents,
          memo: `Pago ${payment.method === "QR" ? "QR Simple" : "por transferencia"} — ${payment.booking?.dog?.name ?? "paseo"}`,
        },
        {
          account: "platform:held",
          credit: payment.amountCents,
          memo: "Retención hasta completar el paseo",
        },
      ],
      "payment",
      payment.id,
      now
    );

    const updated = await db.payment.update({
      where: { id: payment.id },
      data: { status: "HELD", confirmedAt: now, qrRef },
    });

    const bs = formatBOB(payment.amountCents);
    await notify(
      payment.ownerId,
      "PAYMENT",
      "Pago confirmado 🔒",
      `Tu pago de ${bs} quedó retenido por FiruWalk y se liberará al paseador cuando el paseo se complete.`,
      "bookings"
    );
    if (payment.walkerId) {
      await notify(
        payment.walkerId,
        "PAYMENT",
        "Paseo prepagado ✅",
        `El dueño confirmó el pago de ${bs} del paseo de ${payment.booking?.dog?.name ?? "tu próximo paseo"}. El dinero queda retenido hasta completar el paseo.`,
        "home"
      );
    }
    return ok(paymentOf(updated));
  });
}
