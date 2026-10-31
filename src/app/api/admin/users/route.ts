// GET /api/admin/users → SessionUserDTO[] (all users) + walletCents for walkers

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { sessionUserOf } from "@/lib/server/serialize";
import { walletBalances } from "@/lib/server/ledger";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const users = await db.user.findMany({
      include: { walker: true, zone: true },
      orderBy: { createdAt: "asc" },
    });
    const balances = await walletBalances(users.filter((u) => u.walker).map((u) => u.id));
    return ok(
      users.map((u) => ({ ...sessionUserOf(u), walletCents: u.walker ? (balances.get(u.id) ?? 0) : null }))
    );
  });
}
