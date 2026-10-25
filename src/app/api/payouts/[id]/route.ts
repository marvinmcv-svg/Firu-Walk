// PATCH /api/payouts/[id] {action:"paid"|"cancel"} (admin)
//   paid   → status PAID + payout.paid txn (payout:{id} → platform:cash) + audit + notify walker
//   cancel → status CANCELLED + reversal txn (payout:{id} → back to wallet) + audit + notify

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { postTxn } from "@/lib/server/ledger";
import { notify } from "@/lib/server/notify";
import { payoutOf } from "@/lib/server/serialize";
import { formatBOB } from "@/lib/firu/money";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const action = optStr(body, "action");
    if (!action) throw new ApiError(400, "Indica una acción: paid o cancel.");

    const payout = await db.payout.findUnique({ where: { id } });
    if (!payout) throw new ApiError(404, "Pago no encontrado.");
    if (payout.status !== "REQUESTED") {
      throw new ApiError(400, "Este pago ya fue procesado.");
    }
    const walkerUser = await db.user.findUnique({ where: { id: payout.walkerId } });
    const walkerName = walkerUser?.name ?? "paseador";

    const bs = formatBOB(payout.amountCents);
    const now = new Date();

    if (action === "paid") {
      await postTxn(
        [
          { account: `payout:${payout.id}`, debit: payout.amountCents, memo: `Pago enviado (${payout.method})` },
          { account: "platform:cash", credit: payout.amountCents, memo: `Salida a ${walkerName}` },
        ],
        "payout",
        payout.id,
        now
      );
      const updated = await db.payout.update({
        where: { id: payout.id },
        data: { status: "PAID", paidAt: now },
      });
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "PAYOUT_PAID",
          entity: "payout",
          entityId: payout.id,
          detail: `${bs} vía ${payout.method}`,
        },
      });
      await notify(
        payout.walkerId,
        "PAYOUT",
        "¡Pago enviado! 💸",
        `Te enviamos ${bs} por ${payout.method === "BANK" ? "transferencia bancaria" : "QR Simple"}. ¡Buen trabajo! 🐾`,
        "earnings"
      );
      return ok(payoutOf(updated, walkerName));
    }

    if (action === "cancel") {
      // Reversal: the money returns to the walker's wallet
      await postTxn(
        [
          { account: `payout:${payout.id}`, debit: payout.amountCents, memo: "Solicitud cancelada — devuelve a billetera" },
          { account: `walker:${payout.walkerId}`, credit: payout.amountCents, memo: "Retiro cancelado por el equipo — saldo restituido" },
        ],
        "payout",
        payout.id,
        now
      );
      const updated = await db.payout.update({
        where: { id: payout.id },
        data: { status: "CANCELLED" },
      });
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "PAYOUT_CANCELLED",
          entity: "payout",
          entityId: payout.id,
          detail: `${bs}`,
        },
      });
      const reason = optStr(body, "reason", { max: 200 });
      await notify(
        payout.walkerId,
        "PAYOUT",
        "Retiro cancelado",
        `Cancelamos tu solicitud de ${bs}${reason ? `: «${reason}»` : "."} El saldo volvió a tu billetera.`,
        "earnings"
      );
      return ok(payoutOf(updated, walkerName));
    }

    throw new ApiError(400, `Acción desconocida: ${action}`);
  });
}
