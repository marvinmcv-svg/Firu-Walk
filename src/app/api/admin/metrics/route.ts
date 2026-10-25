// GET /api/admin/metrics → AdminMetricsDTO
// Marketplace health: totals, quality %s, retention, supply per zone,
// 14-day booking trend, open dispute count.

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { boDateKey, boDayStartOffset } from "@/lib/server/botime";

const pct = (num: number, den: number): number =>
  den === 0 ? 0 : Math.round((num / den) * 1000) / 10;

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    const [
      owners,
      walkerUsers,
      pendingWalkers,
      dogs,
      bookings,
      completedWalks,
      totalWalks,
      noShowWalks,
      cancelledByOwner,
      cancelledByWalker,
      disputes,
      openDisputes,
      recurringBookings,
      reviews,
      settledPayments,
      revenueEntries,
      zones,
      activeWalkersByZone,
      demandWalksByZone,
      recentBookings,
      ownerBookingGroups,
    ] = await Promise.all([
      db.user.count({ where: { role: "OWNER" } }),
      db.user.count({ where: { role: "WALKER" } }),
      db.walkerProfile.count({ where: { status: "PENDING" } }),
      db.dog.count(),
      db.booking.count(),
      db.walk.count({ where: { status: "COMPLETED" } }),
      db.walk.count(),
      db.walk.count({ where: { status: "NO_SHOW" } }),
      db.booking.count({ where: { cancelledBy: "OWNER" } }),
      db.booking.count({ where: { cancelledBy: "WALKER" } }),
      db.dispute.count(),
      db.dispute.count({ where: { status: "OPEN" } }),
      db.booking.count({ where: { type: "RECURRING" } }),
      db.review.aggregate({ _avg: { rating: true } }),
      db.payment.aggregate({
        where: { status: { in: ["RELEASED", "CASH_SETTLED"] }, createdAt: { gte: monthAgo } },
        _sum: { amountCents: true },
      }),
      db.ledgerEntry.findMany({
        where: { account: "platform:revenue", createdAt: { gte: monthAgo } },
        select: { debitCents: true, creditCents: true },
      }),
      db.zone.findMany({ orderBy: { sortOrder: "asc" } }),
      db.walkerProfile.groupBy({ by: ["zoneId"], where: { status: "ACTIVE" }, _count: true }),
      db.walk.groupBy({
        by: ["zoneId"],
        where: { status: { in: ["COMPLETED", "SCHEDULED"] }, scheduledStart: { gte: monthAgo } },
        _count: true,
      }),
      db.booking.findMany({
        where: { requestedAt: { gte: boDayStartOffset(-13) } },
        select: { requestedAt: true },
      }),
      db.booking.groupBy({ by: ["ownerId"], _count: true }),
    ]);

    const revenueMonthCents = revenueEntries.reduce(
      (s, e) => s + e.creditCents - e.debitCents,
      0
    );
    const avgRating = Math.round((reviews._avg.rating ?? 0) * 10) / 10;

    // 14-day trend keyed by BO-local date
    const trendMap = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      trendMap.set(boDateKey(boDayStartOffset(-i)), 0);
    }
    for (const b of recentBookings) {
      const key = boDateKey(b.requestedAt);
      if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
    }
    const bookingsTrend = [...trendMap.entries()].map(([date, count]) => ({ date, count }));

    const walkersPerZone = new Map(activeWalkersByZone.map((g) => [g.zoneId, g._count]));
    const demandPerZone = new Map(demandWalksByZone.map((g) => [g.zoneId, g._count]));

    return ok({
      totals: {
        owners,
        walkers: walkerUsers,
        pendingWalkers,
        dogs,
        bookings,
        completedWalks,
        gmvMonthCents: settledPayments._sum.amountCents ?? 0,
        revenueMonthCents,
        avgRating,
      },
      quality: {
        completionPct: pct(completedWalks, totalWalks),
        noShowPct: pct(noShowWalks, totalWalks),
        cancelByOwnerPct: pct(cancelledByOwner, bookings),
        cancelByWalkerPct: pct(cancelledByWalker, bookings),
        disputeRatePct: pct(disputes, bookings),
        avgRating,
      },
      retention: {
        ownersWithRepeatBooking: ownerBookingGroups.filter((g) => g._count >= 2).length,
        recurringSharePct: pct(recurringBookings, bookings),
      },
      supplyPerZone: zones.map((z) => ({
        zoneId: z.id,
        zoneName: z.name,
        walkers: walkersPerZone.get(z.id) ?? 0,
        demandWalks: demandPerZone.get(z.id) ?? 0,
      })),
      bookingsTrend,
      recentDisputes: openDisputes,
    });
  });
}
