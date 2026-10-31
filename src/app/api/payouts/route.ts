// GET  /api/payouts → PayoutDTO[] (walker own; admin all)
// POST /api/payouts {amountCents?} → PayoutDTO
//   Walker asks to be paid before the weekly batch: validates ≥
//   payouts.minPayoutCents and ≤ balance, moves the money walker →
//   payout:{id}; the payout joins the next batch at the walker's saved
//   destination (Ganancias → cuenta de cobro).

import { db } from "@/lib/db";
import { ApiError, ok, optNum, readJson, run } from "@/lib/server/http";
import { requireUser, requireWalker } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { walletBalance } from "@/lib/server/ledger";
import { notifyAdmins, notify } from "@/lib/server/notify";
import { formatBOB } from "@/lib/firu/money";
import { payoutOf } from "@/lib/server/serialize";
import { createPayout, destinationOf } from "@/lib/server/payments/payouts";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role === "WALKER") {
      const payouts = await db.payout.findMany({
        where: { walkerId: user.id },
        orderBy: { requestedAt: "desc" },
      });
      return ok(payouts.map((p) => payoutOf(p, user.name)));
    }
    if (user.role === "ADMIN") {
      const payouts = await db.payout.findMany({
        where: {},
        orderBy: { requestedAt: "desc" },
        take: 100,
      });
      const walkers = await db.user.findMany({
        where: { id: { in: [...new Set(payouts.map((p) => p.walkerId))] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(walkers.map((w) => [w.id, w.name]));
      return ok(payouts.map((p) => payoutOf(p, nameById.get(p.walkerId) ?? null)));
    }
    throw new ApiError(403, "No tienes acceso a los pagos.");
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    const cfg = await getAppConfig();
    const body = await readJson(req);
    const profile = user.walker!;

    const balance = await walletBalance(user.id);
    const requested = optNum(body, "amountCents");
    if (requested !== undefined && (!Number.isInteger(requested) || requested <= 0)) {
      throw new ApiError(400, "El monto a retirar es inválido.");
    }
    const amount = requested ?? balance;

    if (balance <= 0) {
      throw new ApiError(400, "No tienes saldo disponible para retirar todavía.");
    }
    if (amount < cfg.payouts.minPayoutCents) {
      throw new ApiError(
        400,
        `El monto mínimo de retiro es ${formatBOB(cfg.payouts.minPayoutCents)}.`
      );
    }
    if (amount > balance) {
      throw new ApiError(
        400,
        `No tienes saldo suficiente (disponible: ${formatBOB(balance)}).`
      );
    }
    if (!profile.payoutAccount) {
      throw new ApiError(400, "Primero registra tu cuenta de cobro (banco o QR).");
    }
    const method = profile.payoutMethod ?? "BANK";

    const payout = await createPayout(user.id, amount, {
      method,
      destRef: destinationOf(profile),
      memo: "Solicitud de pago",
    });

    const bs = formatBOB(amount);
    await notifyAdmins(
      "PAYOUT",
      "Pago solicitado 💸",
      `${user.name} solicitó retirar ${bs} de su billetera (${method}). Entra en el próximo lote.`,
      "payments"
    );
    await notify(
      user.id,
      "PAYOUT",
      "Solicitud registrada ✅",
      `Tu retiro de ${bs} entra en el próximo lote de pagos ${cfg.payouts.cycle === "weekly" ? "semanal" : ""}. Te avisaremos al enviarlo.`,
      "earnings"
    );
    return ok(payoutOf(payout, user.name), { status: 201 });
  });
}
