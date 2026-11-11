// GET /api/admin/referrals → AdminReferralDTO[] (latest 100)

import { db } from "@/lib/db";
import type { AdminReferralDTO } from "@/lib/firu/types";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const rows = await db.referral.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { referrer: { select: { name: true } }, referee: { select: { name: true } } },
    });
    const out: AdminReferralDTO[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      referrerName: r.referrer.name,
      refereeName: r.referee.name,
      rewardCents: r.rewardCents,
      referrerRewarded: r.referrerRewarded,
      createdAt: r.createdAt.toISOString(),
      rewardedAt: r.rewardedAt?.toISOString() ?? null,
      voidReason: r.voidReason,
    }));
    return ok(out);
  });
}
