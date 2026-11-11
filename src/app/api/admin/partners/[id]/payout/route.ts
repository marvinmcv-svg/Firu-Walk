// POST /api/admin/partners/[id]/payout {reference} → {paidCents}
// Ops paid the partner what FiruWalk owes them (bank transfer / QR): the
// whole balance of partner:{id} moves to platform:cash, with the reference.

import { db } from "@/lib/db";
import { formatBOB } from "@/lib/firu/money";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { accountBalance, postTxn } from "@/lib/server/ledger";
import { partnerAccount } from "@/lib/server/referrals";
import { requireAdmin } from "@/lib/server/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const reference = reqStr(await readJson(req), "reference", "La referencia del pago", { max: 120 });
    const partner = await db.partner.findUnique({ where: { id } });
    if (!partner) throw new ApiError(404, "Aliado no encontrado.");

    const paid = await db.$transaction(async (tx) => {
      // Serialize payouts of the same partner.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${partnerAccount(id)}))`;
      const owed = await accountBalance(partnerAccount(id), tx);
      if (owed <= 0) return 0;
      await postTxn(
        [
          { account: partnerAccount(id), debit: owed, memo: `Pago a ${partner.name} — ref. ${reference}` },
          { account: "platform:cash", credit: owed, memo: `Comisiones de referidos — ${partner.name}` },
        ],
        "partner",
        id,
        new Date(),
        tx
      );
      return owed;
    });
    if (paid === 0) throw new ApiError(400, "No hay comisiones pendientes para este aliado.");
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "PARTNER_PAID",
        entity: "partner",
        entityId: id,
        detail: `${formatBOB(paid)} — ref. ${reference}`,
      },
    });
    return ok({ paidCents: paid });
  });
}
