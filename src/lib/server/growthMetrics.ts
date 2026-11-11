// Weekly growth review (Phase 2 soft launch, LAUNCH_PLAN §6):
//   - weekly table: new owners, active owners, walks, walks per active owner,
//     on-time starts, no-shows, GMV, revenue, gifted-walk spend, contribution
//   - monthly cohorts: owners by month of their first completed walk, and the
//     share that walked again in month 2 and month 3 (north-star retention)
//   - acquisition channels: sign-ups and activation per channel
//   - referrals: "Regalá un paseo" funnel and cost
//   - leakage signal: regulars who stopped booking while their walker stays busy
//
// Soft-launch scale (hundreds of owners): rows are aggregated in memory over a
// bounded window rather than with SQL window functions.

import { db } from "@/lib/db";
import type { GrowthMetricsDTO } from "@/lib/firu/types";
import { BO_OFFSET_MS, boDateKey, boDayStart, boDayOfWeek } from "./botime";
import { MARKETING_ACCOUNT } from "./referrals";

const DAY = 86_400_000;
const WEEKS = 8;
const COHORT_MONTHS = 6;
/** A walk started within this many minutes of its time counts as on time. */
export const ON_TIME_MINUTES = 10;
/** Leakage: a regular (≥3 walks) quiet for this many days … */
const LEAK_QUIET_DAYS = 14;
/** … whose usual walker still did at least this many walks in that window. */
const LEAK_WALKER_BUSY = 6;

/** Peak walking hours in Santa Cruz (midday heat makes walks unsafe), minutes from 00:00. */
export const PEAK_WINDOWS: [number, number][] = [
  [6 * 60, 9 * 60],
  [17 * 60 + 30, 20 * 60],
];
/** Open a new zone only once existing ones are this busy at peak (LAUNCH_PLAN Phase 3). */
export const EXPAND_THRESHOLD_PCT = 70;
const UTIL_DAYS = 28;

const pct = (num: number, den: number): number => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

/** Monday 00:00 (Bolivia) of the week containing `d`. */
export function boWeekStart(d: Date): Date {
  const day = boDayStart(d);
  const back = (boDayOfWeek(d) + 6) % 7;
  return new Date(day.getTime() - back * DAY);
}

/** Bolivia-local "YYYY-MM" of a UTC date. */
const boMonthKey = (d: Date) => boDateKey(d).slice(0, 7);

/** "YYYY-MM" `n` months after `key`. */
function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export async function growthMetrics(now: Date = new Date()): Promise<GrowthMetricsDTO> {
  const thisWeek = boWeekStart(now);
  const from = new Date(thisWeek.getTime() - (WEEKS - 1) * 7 * DAY);
  const cohortFrom = new Date(boDayStart(now).getTime() - (COHORT_MONTHS + 3) * 31 * DAY);

  const [owners, walks, settled, ledger, referrals, gifts] = await Promise.all([
    db.user.findMany({
      where: { role: "OWNER" },
      select: { id: true, name: true, createdAt: true, acquisitionChannel: true, importedAt: true },
    }),
    db.walk.findMany({
      where: { scheduledStart: { gte: cohortFrom < from ? cohortFrom : from } },
      select: {
        id: true,
        ownerId: true,
        walkerId: true,
        status: true,
        scheduledStart: true,
        startedAt: true,
        endedAt: true,
      },
    }),
    db.payment.findMany({
      where: { status: { in: ["RELEASED", "CASH_SETTLED"] }, purpose: "WALK", confirmedAt: { gte: from } },
      select: { amountCents: true, refundedCents: true, confirmedAt: true, method: true },
    }),
    db.ledgerEntry.findMany({
      where: { account: { in: ["platform:revenue", MARKETING_ACCOUNT] }, createdAt: { gte: from } },
      select: { account: true, debitCents: true, creditCents: true, createdAt: true },
    }),
    db.referral.findMany({ select: { status: true, createdAt: true, rewardedAt: true, referrerRewarded: true } }),
    db.subscription.findMany({ where: { gift: true }, select: { walksUsed: true, status: true, priceCents: true } }),
  ]);

  // ---------------- weekly table ----------------
  const weekKeys: string[] = [];
  for (let i = 0; i < WEEKS; i++) weekKeys.push(boDateKey(new Date(from.getTime() + i * 7 * DAY)));
  type Week = GrowthMetricsDTO["weeks"][number] & { _active: Set<string>; _started: number; _onTime: number; _due: number; _noShow: number };
  const weeks = new Map<string, Week>(
    weekKeys.map((k) => [
      k,
      {
        weekStart: k,
        newOwners: 0,
        activeOwners: 0,
        completedWalks: 0,
        walksPerActiveOwner: 0,
        onTimePct: 0,
        noShowPct: 0,
        gmvCents: 0,
        revenueCents: 0,
        giftSpendCents: 0,
        contributionPerWalkCents: 0,
        referralSignups: 0,
        referralsRewarded: 0,
        _active: new Set<string>(),
        _started: 0,
        _onTime: 0,
        _due: 0,
        _noShow: 0,
      },
    ])
  );
  const weekOf = (d: Date | null | undefined): Week | undefined =>
    d && d >= from ? weeks.get(boDateKey(boWeekStart(d))) : undefined;

  for (const o of owners) {
    const w = weekOf(o.importedAt ?? o.createdAt);
    if (w) w.newOwners++;
  }
  for (const wk of walks) {
    const w = weekOf(wk.scheduledStart);
    if (!w || wk.scheduledStart > now) continue;
    if (wk.status === "COMPLETED") {
      w.completedWalks++;
      w._active.add(wk.ownerId);
    }
    if (wk.status === "COMPLETED" || wk.status === "NO_SHOW" || wk.status === "IN_PROGRESS") w._due++;
    if (wk.status === "NO_SHOW") w._noShow++;
    if (wk.startedAt) {
      w._started++;
      if (Math.abs(wk.startedAt.getTime() - wk.scheduledStart.getTime()) <= ON_TIME_MINUTES * 60_000) w._onTime++;
    }
  }
  for (const p of settled) {
    const w = weekOf(p.confirmedAt);
    if (w) w.gmvCents += p.amountCents - p.refundedCents;
  }
  for (const e of ledger) {
    const w = weekOf(e.createdAt);
    if (!w) continue;
    if (e.account === "platform:revenue") w.revenueCents += e.creditCents - e.debitCents;
    // Gifts spent = money that left marketing net of what came back unused.
    else w.giftSpendCents += e.debitCents - e.creditCents;
  }
  for (const r of referrals) {
    const a = weekOf(r.createdAt);
    if (a && r.status !== "VOID") a.referralSignups++;
    const b = weekOf(r.rewardedAt);
    if (b && r.status === "REWARDED") b.referralsRewarded++;
  }
  const weekRows = [...weeks.values()].map(({ _active, _started, _onTime, _due, _noShow, ...w }) => ({
    ...w,
    activeOwners: _active.size,
    walksPerActiveOwner: _active.size ? Math.round((w.completedWalks / _active.size) * 10) / 10 : 0,
    onTimePct: pct(_onTime, _started),
    noShowPct: pct(_noShow, _due),
    contributionPerWalkCents: w.completedWalks
      ? Math.round((w.revenueCents - w.giftSpendCents) / w.completedWalks)
      : 0,
  }));

  // ---------------- monthly retention cohorts ----------------
  // Cohort = month of the owner's first completed walk (all time).
  const firsts = await db.walk.groupBy({
    by: ["ownerId"],
    where: { status: "COMPLETED" },
    _min: { scheduledStart: true },
  });
  const monthsWalked = new Map<string, Set<string>>();
  for (const wk of walks) {
    if (wk.status !== "COMPLETED") continue;
    let s = monthsWalked.get(wk.ownerId);
    if (!s) monthsWalked.set(wk.ownerId, (s = new Set()));
    s.add(boMonthKey(wk.scheduledStart));
  }
  const nowMonth = boMonthKey(now);
  const cohortKeys: string[] = [];
  for (let i = COHORT_MONTHS - 1; i >= 0; i--) cohortKeys.push(addMonths(nowMonth, -i));
  const cohorts = cohortKeys.map((month) => {
    const members = firsts.filter((f) => f._min.scheduledStart && boMonthKey(f._min.scheduledStart) === month);
    const m2 = addMonths(month, 1);
    const m3 = addMonths(month, 2);
    const back = (key: string) => members.filter((f) => monthsWalked.get(f.ownerId)?.has(key)).length;
    return {
      month,
      owners: members.length,
      // A month that has not started yet has no answer (null), not 0 %.
      m2Pct: m2 <= nowMonth ? pct(back(m2), members.length) : null,
      m3Pct: m3 <= nowMonth ? pct(back(m3), members.length) : null,
    };
  });

  // ---------------- channels ----------------
  const activated = new Set(firsts.map((f) => f.ownerId));
  const byChannel = new Map<string, { owners: number; activated: number }>();
  for (const o of owners) {
    const key = o.acquisitionChannel ?? "unknown";
    const c = byChannel.get(key) ?? { owners: 0, activated: 0 };
    c.owners++;
    if (activated.has(o.id)) c.activated++;
    byChannel.set(key, c);
  }
  const channels = [...byChannel.entries()]
    .map(([channel, c]) => ({ channel, owners: c.owners, activated: c.activated, activationPct: pct(c.activated, c.owners) }))
    .sort((a, b) => b.owners - a.owners);

  // ---------------- referrals ----------------
  const marketing = await db.ledgerEntry.aggregate({
    where: { account: MARKETING_ACCOUNT },
    _sum: { debitCents: true, creditCents: true },
  });
  const referralStats = {
    pending: referrals.filter((r) => r.status === "PENDING").length,
    rewarded: referrals.filter((r) => r.status === "REWARDED").length,
    void: referrals.filter((r) => r.status === "VOID").length,
    giftWalksIssued: gifts.length,
    giftWalksUsed: gifts.reduce((s, g) => s + g.walksUsed, 0),
    giftCostCents: (marketing._sum.debitCents ?? 0) - (marketing._sum.creditCents ?? 0),
  };

  // ---------------- leakage signal ----------------
  const quietSince = new Date(now.getTime() - LEAK_QUIET_DAYS * DAY);
  const doneByOwner = new Map<string, { count: number; last: Date; walkers: Map<string, number> }>();
  const recentByWalker = new Map<string, number>();
  for (const wk of walks) {
    if (wk.status !== "COMPLETED") continue;
    const o = doneByOwner.get(wk.ownerId) ?? { count: 0, last: wk.scheduledStart, walkers: new Map() };
    o.count++;
    if (wk.scheduledStart > o.last) o.last = wk.scheduledStart;
    o.walkers.set(wk.walkerId, (o.walkers.get(wk.walkerId) ?? 0) + 1);
    doneByOwner.set(wk.ownerId, o);
    if (wk.scheduledStart >= quietSince) recentByWalker.set(wk.walkerId, (recentByWalker.get(wk.walkerId) ?? 0) + 1);
  }
  const upcoming = new Set(
    walks.filter((w) => w.status === "SCHEDULED" && w.scheduledStart >= now).map((w) => w.ownerId)
  );
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const leakCandidates = [...doneByOwner.entries()]
    .filter(([id, o]) => o.count >= 3 && o.last < quietSince && !upcoming.has(id))
    .map(([id, o]) => {
      const [walkerId] = [...o.walkers.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ownerId: id, walks: o.count, lastWalkAt: o.last, walkerId, walkerRecentWalks: recentByWalker.get(walkerId) ?? 0 };
    })
    .filter((c) => c.walkerRecentWalks >= LEAK_WALKER_BUSY)
    .sort((a, b) => b.walkerRecentWalks - a.walkerRecentWalks)
    .slice(0, 10);
  const walkerNames = new Map(
    (
      await db.user.findMany({
        where: { id: { in: leakCandidates.map((c) => c.walkerId) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name])
  );
  const leakage = leakCandidates.map((c) => ({
    ownerId: c.ownerId,
    ownerName: ownerName.get(c.ownerId) ?? "—",
    walks: c.walks,
    lastWalkAt: c.lastWalkAt.toISOString(),
    walkerName: walkerNames.get(c.walkerId) ?? "—",
    walkerRecentWalks: c.walkerRecentWalks,
  }));

  const zoneRows = await zoneUtilization(now);

  return {
    generatedAt: now.toISOString(),
    zones: zoneRows,
    expandThresholdPct: EXPAND_THRESHOLD_PCT,
    onTimeMinutes: ON_TIME_MINUTES,
    weeks: weekRows,
    cohorts,
    channels,
    referrals: referralStats,
    leakage,
    leakQuietDays: LEAK_QUIET_DAYS,
  };
}

/** Minutes of [a, b) inside the peak windows. */
function peakOverlap(a: number, b: number): number {
  return PEAK_WINDOWS.reduce((s, [p, q]) => s + Math.max(0, Math.min(b, q) - Math.max(a, p)), 0);
}

/**
 * Peak-hour utilization per zone over the last 4 weeks: walk minutes booked
 * inside the peak windows ÷ the peak minutes ACTIVE walkers of the zone have
 * on their weekly availability.
 */
export async function zoneUtilization(now: Date = new Date()): Promise<GrowthMetricsDTO["zones"]> {
  const since = new Date(now.getTime() - UTIL_DAYS * DAY);
  const [zones, walkers, walks] = await Promise.all([
    db.zone.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.walkerProfile.findMany({
      where: { status: "ACTIVE" },
      select: { zoneId: true, availabilities: { select: { startMinute: true, endMinute: true } } },
    }),
    db.walk.findMany({
      where: {
        scheduledStart: { gte: since, lt: now },
        status: { in: ["COMPLETED", "IN_PROGRESS", "SCHEDULED", "NO_SHOW"] },
      },
      select: { zoneId: true, scheduledStart: true, durationMin: true },
    }),
  ]);
  const weeks = UTIL_DAYS / 7;
  const capacity = new Map<string, { walkers: number; minutes: number }>();
  for (const w of walkers) {
    const c = capacity.get(w.zoneId) ?? { walkers: 0, minutes: 0 };
    c.walkers++;
    for (const a of w.availabilities) c.minutes += peakOverlap(a.startMinute, a.endMinute) * weeks;
    capacity.set(w.zoneId, c);
  }
  const booked = new Map<string, number>();
  for (const w of walks) {
    const local = new Date(w.scheduledStart.getTime() - BO_OFFSET_MS);
    const start = local.getUTCHours() * 60 + local.getUTCMinutes();
    booked.set(w.zoneId, (booked.get(w.zoneId) ?? 0) + peakOverlap(start, start + w.durationMin));
  }
  return zones.map((z) => {
    const c = capacity.get(z.id) ?? { walkers: 0, minutes: 0 };
    const b = booked.get(z.id) ?? 0;
    const util = pct(b, c.minutes);
    return {
      zoneId: z.id,
      zoneName: z.name,
      activeWalkers: c.walkers,
      peakCapacityMin: Math.round(c.minutes),
      peakBookedMin: b,
      peakUtilizationPct: util,
      // Saturated: add walkers here or open a neighbouring zone.
      readyToExpand: c.minutes > 0 && util >= EXPAND_THRESHOLD_PCT,
    };
  });
}
