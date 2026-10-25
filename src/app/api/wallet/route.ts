// GET /api/wallet → WalletDTO (walker): balance, pending payouts,
// lifetime earned, latest 20 ledger entries on walker:{id}.

import { ok, run } from "@/lib/server/http";
import { requireWalker } from "@/lib/server/session";
import { lifetimeEarned, walletBalance } from "@/lib/server/ledger";
import { ledgerEntryOf } from "@/lib/server/serialize";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);

    const [balance, pending, earned, entries] = await Promise.all([
      walletBalance(user.id),
      db.payout.aggregate({
        where: { walkerId: user.id, status: "REQUESTED" },
        _sum: { amountCents: true },
      }),
      lifetimeEarned(user.id),
      db.ledgerEntry.findMany({
        where: { account: `walker:${user.id}` },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return ok({
      balanceCents: balance,
      pendingPayoutCents: pending._sum.amountCents ?? 0,
      lifetimeEarnedCents: earned,
      entries: entries.map(ledgerEntryOf),
    });
  });
}
