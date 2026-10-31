// GET   /api/wallet → WalletDTO (walker): balance, pending payouts, lifetime
//       earned, latest 20 ledger entries, payout destination, cash-debt limit.
// PATCH /api/wallet {payoutMethod, payoutBank?, payoutAccount, payoutHolder}
//       → saves where the weekly payout is sent.

import { z } from "zod";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireWalker } from "@/lib/server/session";
import { getAppConfig } from "@/lib/server/config";
import { lifetimeEarned, walletBalance } from "@/lib/server/ledger";
import { ledgerEntryOf } from "@/lib/server/serialize";
import { db } from "@/lib/db";

const Destination = z
  .object({
    payoutMethod: z.enum(["QR", "BANK"]),
    payoutBank: z.string().trim().max(60).optional(),
    payoutAccount: z.string().trim().min(4, "Indica el número de cuenta o alias QR.").max(40),
    payoutHolder: z.string().trim().min(3, "Indica el titular de la cuenta.").max(80),
  })
  .refine((d) => d.payoutMethod === "QR" || !!d.payoutBank, {
    message: "Indica el banco.",
    path: ["payoutBank"],
  });

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    const cfg = await getAppConfig();

    const [balance, pending, earned, entries] = await Promise.all([
      walletBalance(user.id),
      db.payout.aggregate({
        where: { walkerId: user.id, status: { in: ["REQUESTED", "APPROVED"] } },
        _sum: { amountCents: true },
      }),
      lifetimeEarned(user.id),
      db.ledgerEntry.findMany({
        where: { account: `walker:${user.id}` },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    const w = user.walker!;

    return ok({
      balanceCents: balance,
      pendingPayoutCents: pending._sum.amountCents ?? 0,
      lifetimeEarnedCents: earned,
      entries: entries.map(ledgerEntryOf),
      destination: {
        payoutMethod: w.payoutMethod,
        payoutBank: w.payoutBank,
        payoutAccount: w.payoutAccount,
        payoutHolder: w.payoutHolder,
      },
      maxCashDebtCents: cfg.payouts.maxCashDebtCents,
      blockedForDebt: -balance > cfg.payouts.maxCashDebtCents,
    });
  });
}

export async function PATCH(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    const parsed = Destination.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos de la cuenta inválidos.");
    const d = parsed.data;
    const updated = await db.walkerProfile.update({
      where: { id: user.walker!.id },
      data: {
        payoutMethod: d.payoutMethod,
        payoutBank: d.payoutMethod === "QR" ? null : d.payoutBank,
        payoutAccount: d.payoutAccount,
        payoutHolder: d.payoutHolder,
      },
    });
    await db.auditLog.create({
      data: { actorId: user.id, action: "PAYOUT_DESTINATION_UPDATED", entity: "walker", entityId: updated.id },
    });
    return ok({
      payoutMethod: updated.payoutMethod,
      payoutBank: updated.payoutBank,
      payoutAccount: updated.payoutAccount,
      payoutHolder: updated.payoutHolder,
    });
  });
}
