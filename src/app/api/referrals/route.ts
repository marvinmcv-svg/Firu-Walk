// GET /api/referrals → ReferralSummaryDTO — the owner's "Regalá un paseo"
// card: their code (created on first use), share link and progress.

import { db } from "@/lib/db";
import type { ReferralSummaryDTO } from "@/lib/firu/types";
import { priceBandForDuration } from "@/lib/server/bookingEngine";
import { getAppConfig } from "@/lib/server/config";
import { ApiError, ok, run } from "@/lib/server/http";
import { REDEEM_WINDOW_DAYS, ensureReferralCode } from "@/lib/server/referrals";
import { requireUser } from "@/lib/server/session";
import { appBaseUrl } from "@/lib/server/partners";


export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    if (user.role !== "OWNER") throw new ApiError(403, "Solo los dueños pueden invitar amigos.");
    const cfg = await getAppConfig();
    const code = await ensureReferralCode(user);

    const [groups, mine, viaPartner, walked] = await Promise.all([
      db.referral.groupBy({ by: ["status", "referrerRewarded"], where: { referrerId: user.id }, _count: true }),
      db.referral.findUnique({ where: { refereeId: user.id }, select: { status: true } }),
      db.user.findUnique({
        where: { id: user.id },
        select: { partnerRewardedAt: true, partner: { select: { name: true, giftWalk: true } } },
      }),
      db.walk.count({ where: { ownerId: user.id, status: "COMPLETED" } }),
    ]);
    const count = (f: (g: (typeof groups)[number]) => boolean) =>
      groups.filter(f).reduce((s, g) => s + g._count, 0);
    const rewarded = count((g) => g.referrerRewarded);
    const durationMin = [30, 45, 60].includes(cfg.referrals.giftDurationMin) ? cfg.referrals.giftDurationMin : 30;
    const fresh = Date.now() - user.createdAt.getTime() <= REDEEM_WINDOW_DAYS * 86_400_000;

    const dto: ReferralSummaryDTO = {
      enabled: !!cfg.referrals.enabled,
      code,
      shareUrl: `${appBaseUrl(req)}/?ref=${encodeURIComponent(code)}`,
      giftDurationMin: durationMin,
      giftValueCents: priceBandForDuration(cfg, durationMin),
      giftValidDays: cfg.referrals.giftValidDays,
      invited: count((g) => g.status !== "VOID"),
      pending: count((g) => g.status === "PENDING"),
      rewarded,
      rewardsLeft: Math.max(0, cfg.referrals.maxRewardsPerReferrer - rewarded),
      canRedeem: !mine && !viaPartner?.partner && walked === 0 && fresh,
      referredBy: mine
        ? { status: mine.status }
        : viaPartner?.partner?.giftWalk // (no welcome gift → nothing to show)
          ? { status: viaPartner.partnerRewardedAt ? "REWARDED" : "PENDING", partnerName: viaPartner.partner.name }
          : null,
    };
    return ok(dto);
  });
}
