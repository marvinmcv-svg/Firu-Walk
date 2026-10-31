// PATCH /api/disputes/[id] (admin) {action:"refund"|"credit"|"dismiss",
//   refundCents?, creditCents?, resolution?}
//   refund (payment HELD → refund from platform:held; RELEASED → claw back from walker;
//          QR payments are refunded through the provider or queued for ops)
//   credit → owner receives credit from platform:revenue
//   dismiss → no money
// All paths: audit log + notify both parties.

import type { DisputeStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, ok, optNum, optStr, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { postTxn } from "@/lib/server/ledger";
import { refundPayment } from "@/lib/server/payments/service";
import { notify } from "@/lib/server/notify";
import { formatBOB } from "@/lib/firu/money";
import { disputeInclude, disputeOf } from "@/lib/server/serialize";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const cfg = await getAppConfig();
    const body = await readJson(req);

    const dispute = await db.dispute.findUnique({
      where: { id },
      include: { booking: { include: { dog: true, owner: true, walker: true } } },
    });
    if (!dispute) throw new ApiError(404, "Disputa no encontrada.");
    if (dispute.status !== "OPEN") {
      throw new ApiError(400, "Esta disputa ya fue resuelta.");
    }

    const action = optStr(body, "action");
    if (!action) throw new ApiError(400, "Indica una acción: refund, credit o dismiss.");
    const resolution = optStr(body, "resolution", { max: 600 }) ?? null;
    const now = new Date();
    const dogName = dispute.booking?.dog?.name ?? "la mascota";

    let status: DisputeStatus;
    let refundCents = 0;
    let creditCents = 0;

    if (action === "refund") {
      refundCents = optNum(body, "refundCents") ?? dispute.booking?.pricePerWalkCents ?? 0;
      if (!Number.isInteger(refundCents) || refundCents <= 0) {
        throw new ApiError(400, "El monto de reembolso es inválido.");
      }
      // Latest collected payment of the booking (held or already released).
      const payment = await db.payment.findFirst({
        where: { bookingId: dispute.bookingId, status: { in: ["HELD", "RELEASED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (!payment) throw new ApiError(400, "No hay un pago cobrado asociado a esta reserva.");
      const ownerId = dispute.booking!.ownerId;
      refundCents = Math.min(refundCents, payment.amountCents - payment.refundedCents);
      const bs = formatBOB(refundCents);
      await refundPayment(payment, refundCents, { refType: "dispute", refId: dispute.id, dogName, at: now });

      // Optional walker strike on refunds
      if (dispute.againstUserId) {
        await db.walkerProfile.updateMany({
          where: { userId: dispute.againstUserId },
          data: { strikes: { increment: 1 } },
        });
      }
      status = "RESOLVED_OWNER";
      await notify(
        ownerId,
        "DISPUTE",
        "Disputa resuelta a tu favor ✅",
        `Te reembolsamos ${bs} por el paseo de ${dogName}.${resolution ? ` Nota del equipo: «${resolution}»` : ""}`,
        "bookings"
      );
      if (dispute.againstUserId) {
        await notify(
          dispute.againstUserId,
          "DISPUTE",
          "Disputa resuelta",
          `El equipo resolvió la disputa del paseo de ${dogName} con un reembolso al dueño de ${bs} (se revirtió de tu billetera).${resolution ? ` Nota: «${resolution}»` : ""}`,
          "earnings"
        );
      }
    } else if (action === "credit") {
      creditCents = optNum(body, "creditCents") ?? cfg.policy.noShowCreditCents;
      if (!Number.isInteger(creditCents) || creditCents <= 0) {
        throw new ApiError(400, "El monto del crédito es inválido.");
      }
      const ownerId = dispute.booking!.ownerId;
      const bs = formatBOB(creditCents);
      await postTxn(
        [
          { account: "platform:revenue", debit: creditCents, memo: `Crédito por disputa — ${dogName}` },
          { account: `owner:${ownerId}`, credit: creditCents, memo: `Crédito de cortesía ${bs}` },
        ],
        "dispute",
        dispute.id,
        now
      );
      status = "RESOLVED_OWNER";
      await notify(
        ownerId,
        "DISPUTE",
        "Recibiste un crédito 🧡",
        `Te acreditamos ${bs} como compensación por el paseo de ${dogName}.${resolution ? ` Nota del equipo: «${resolution}»` : ""}`,
        "bookings"
      );
      if (dispute.againstUserId) {
        await notify(
          dispute.againstUserId,
          "DISPUTE",
          "Disputa resuelta",
          `El equipo resolvió la disputa del paseo de ${dogName} con un crédito al dueño (sin cargo a tu billetera).${resolution ? ` Nota: «${resolution}»` : ""}`,
          "home"
        );
      }
    } else if (action === "dismiss") {
      status = "DISMISSED";
      await notify(
        dispute.openedById,
        "DISPUTE",
        "Disputa revisada",
        `Revisamos tu reporte sobre el paseo de ${dogName} y, con la información disponible, no procede un reembolso.${resolution ? ` Nota del equipo: «${resolution}»` : ""}`,
        "bookings"
      );
      if (dispute.againstUserId) {
        await notify(
          dispute.againstUserId,
          "DISPUTE",
          "Disputa desestimada ✅",
          `El equipo revisó la disputa del paseo de ${dogName} y la desestimó: no afecta tu cuenta.${resolution ? ` Nota: «${resolution}»` : ""}`,
          "home"
        );
      }
    } else {
      throw new ApiError(400, `Acción desconocida: ${action}`);
    }

    const updated = await db.dispute.update({
      where: { id: dispute.id },
      data: {
        status,
        resolution,
        refundCents,
        creditCents,
        resolvedById: admin.id,
        resolvedAt: now,
      },
      include: disputeInclude,
    });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: `DISPUTE_${action.toUpperCase()}`,
        entity: "dispute",
        entityId: dispute.id,
        detail: `refund=${refundCents} credit=${creditCents}`,
      },
    });
    return ok(await disputeOf(updated));
  });
}
