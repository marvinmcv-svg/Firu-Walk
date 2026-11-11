/// <reference types="bun-types" />
// Phase 2 (soft launch): "Regalá un paseo" referrals with gifted walks paid
// from platform:marketing, Phase-0 customer import, and the weekly growth
// metrics. The ledger must still balance after all of it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as mockPayRoute from "@/app/api/payments/mock/pay/route";
import * as plansRoute from "@/app/api/plans/route";
import * as subscriptionsRoute from "@/app/api/subscriptions/route";
import * as adminPlansRoute from "@/app/api/admin/plans/route";
import * as referralsRoute from "@/app/api/referrals/route";
import * as redeemRoute from "@/app/api/referrals/redeem/route";
import * as adminReferralsRoute from "@/app/api/admin/referrals/route";
import * as adminReferralRoute from "@/app/api/admin/referrals/[id]/route";
import * as importRoute from "@/app/api/admin/owners/import/route";
import * as growthRoute from "@/app/api/admin/metrics/growth/route";
import * as configRoute from "@/app/api/admin/config/route";
import { setOtpSendersForTests } from "@/lib/server/auth/otpSenders";
import { getAppConfig, updateConfigSection } from "@/lib/server/config";
import { accountBalance, walletBalance } from "@/lib/server/ledger";
import { expireSubscriptions } from "@/lib/server/payments/plans";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { boWeekStart } from "@/lib/server/growthMetrics";
import { boDateKey } from "@/lib/server/botime";
import { normalizeChannel, normalizeCode } from "@/lib/server/referrals";
import { call, cookieFor, PHONES, userId } from "./helpers";
import {
  book as bookWith,
  CaptureSender,
  expectLedgerBalanced,
  makeBookable,
  signUp as signUpAs,
  walkIt as walkWith,
  type H,
} from "./flows";

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

const sender = new CaptureSender();
const signUp = (extra: Record<string, unknown>) => signUpAs(sender, 2, extra);
const book = (ownerId: string, cookie: string, body: Record<string, unknown>) => bookWith(ownerId, cookie, ids.luis, body);
const walkIt = (bookingId: string) => walkWith(bookingId, cookies.luis);

let originalReferrals: Awaited<ReturnType<typeof getAppConfig>>["referrals"];

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  setOtpSendersForTests([sender]);
  process.env.DEMO_MODE = "false";
  await db.rateLimit.deleteMany();
  for (const k of ["admin", "ana", "carlos", "luis"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
  originalReferrals = (await getAppConfig()).referrals;
  await updateConfigSection("referrals", { enabled: 1, giftDurationMin: 30, giftValidDays: 60, maxRewardsPerReferrer: 10 });
});

afterAll(async () => {
  await updateConfigSection("referrals", { ...originalReferrals });
  setOtpSendersForTests(null);
  setRealtimePublisherForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

describe("helpers", () => {
  test("codes and channels are normalized", () => {
    expect(normalizeCode(" ana-7k2q ")).toBe("ANA7K2Q");
    expect(normalizeCode("Ñandú 1")).toBe("NANDU1");
    expect(normalizeChannel("IG")).toBe("instagram");
    expect(normalizeChannel("volante")).toBe("flyer");
    expect(normalizeChannel("something")).toBe("other");
    expect(normalizeChannel("")).toBeNull();
  });

  test("weeks start on Monday 00:00 Bolivia time", () => {
    // Wed 2026-11-11 15:00 Bolivia = 19:00 UTC → Mon 2026-11-09 04:00 UTC
    expect(boWeekStart(new Date("2026-11-11T19:00:00Z")).toISOString()).toBe("2026-11-09T04:00:00.000Z");
    // Sun 23:30 Bolivia still belongs to the week that started on Monday.
    expect(boWeekStart(new Date("2026-11-16T03:30:00Z")).toISOString()).toBe("2026-11-09T04:00:00.000Z");
  });
});

describe("referral code", () => {
  test("an owner gets a stable code and a share link", async () => {
    const r1 = await call(referralsRoute.GET as H, { cookie: cookies.ana });
    expect(r1.status).toBe(200);
    expect(r1.json.code).toMatch(/^[A-Z]{1,4}[2-9A-Z]{4}$/);
    expect(r1.json.shareUrl).toContain(`/?ref=${r1.json.code}`);
    expect(r1.json.giftValueCents).toBe((await getAppConfig()).pricing.price30Cents);
    const r2 = await call(referralsRoute.GET as H, { cookie: cookies.ana });
    expect(r2.json.code).toBe(r1.json.code);
    ids.anaCode = r1.json.code;
  });

  test("walkers have no referral card", async () => {
    expect((await call(referralsRoute.GET as H, { cookie: cookies.luis })).status).toBe(403);
  });
});

describe("sign-up with a code", () => {
  test("a valid code (typed loosely) links the new owner; channel becomes referral", async () => {
    const loose = `${ids.anaCode.slice(0, 3).toLowerCase()}-${ids.anaCode.slice(3).toLowerCase()}`;
    const s = await signUp({ referralCode: loose, channel: "ig" });
    expect(s.json.isNew).toBe(true);
    expect(s.json.referral).toEqual({ applied: true });
    const u = await db.user.findUniqueOrThrow({ where: { id: s.id }, include: { referredBy: true } });
    expect(u.acquisitionChannel).toBe("referral");
    expect(u.referredBy?.referrerId).toBe(ids.ana);
    expect(u.referredBy?.status).toBe("PENDING");
    ids.bea = s.id;
    cookies.bea = s.cookie;
  });

  test("a bad code never blocks sign-up; the channel is recorded", async () => {
    const s = await signUp({ referralCode: "NOPE9999", channel: "tiktok" });
    expect(s.json.referral).toEqual({ applied: false });
    const u = await db.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(u.acquisitionChannel).toBe("tiktok");
    ids.cleo = s.id;
    cookies.cleo = s.cookie;
  });

  test("redeem later: not your own code, once only", async () => {
    const own = await call(referralsRoute.GET as H, { cookie: cookies.cleo });
    expect(own.json.canRedeem).toBe(true);
    const self = await call(redeemRoute.POST as H, { method: "POST", cookie: cookies.cleo, body: { code: own.json.code } });
    expect(self.status).toBe(400);
    const good = await call(redeemRoute.POST as H, { method: "POST", cookie: cookies.cleo, body: { code: ids.anaCode } });
    expect(good.status).toBe(200);
    const again = await call(redeemRoute.POST as H, { method: "POST", cookie: cookies.cleo, body: { code: ids.anaCode } });
    expect(again.status).toBe(400);
    const after = await call(referralsRoute.GET as H, { cookie: cookies.cleo });
    expect(after.json.canRedeem).toBe(false);
    expect(after.json.referredBy).toEqual({ status: "PENDING" });
  });

  test("owners who already walked cannot redeem", async () => {
    const r = await call(redeemRoute.POST as H, { method: "POST", cookie: cookies.carlos, body: { code: ids.anaCode } });
    expect(r.status).toBe(400);
  });
});

describe("reward on the friend's first paid walk", () => {
  test("both sides get a gifted walk funded from platform:marketing", async () => {
    await makeBookable(ids.bea);
    const marketingBefore = await accountBalance("platform:marketing");
    const b = await book(ids.bea, cookies.bea, { paymentMethod: "QR" });
    const paid = await call(mockPayRoute.POST as H, { method: "POST", cookie: cookies.bea, body: { paymentId: b.payment.id } });
    expect(paid.json.status).toBe("HELD");
    await walkIt(b.id);

    const ref = await db.referral.findUniqueOrThrow({ where: { refereeId: ids.bea } });
    expect(ref.status).toBe("REWARDED");
    expect(ref.referrerRewarded).toBe(true);
    const value = (await getAppConfig()).pricing.price30Cents;
    expect(ref.rewardCents).toBe(value);

    for (const [owner, giftId] of [
      [ids.bea, ref.refereeGiftId],
      [ids.ana, ref.referrerGiftId],
    ] as const) {
      const sub = await db.subscription.findUniqueOrThrow({ where: { id: giftId! } });
      expect(sub.ownerId).toBe(owner);
      expect(sub.gift).toBe(true);
      expect(sub.status).toBe("ACTIVE");
      expect(sub.walksTotal).toBe(1);
      expect(await accountBalance(`plan:${sub.id}`)).toBe(value);
    }
    expect(await accountBalance("platform:marketing")).toBe(marketingBefore - 2 * value);
    ids.beaGift = ref.refereeGiftId!;
    ids.anaGift = ref.referrerGiftId!;
    await expectLedgerBalanced();
  });

  test("the gift shows in the owner's plans; the gift plan is never for sale", async () => {
    const subs = await call(subscriptionsRoute.GET as H, { cookie: cookies.bea });
    const gift = subs.json.find((s: { id: string }) => s.id === ids.beaGift);
    expect(gift.gift).toBe(true);
    expect(gift.walksLeft).toBe(1);

    const catalogue = await call(plansRoute.GET as H, {});
    expect(catalogue.json.some((p: { key: string }) => p.key.startsWith("gift-walk-"))).toBe(false);
    const adminList = await call(adminPlansRoute.GET as H, { cookie: cookies.admin });
    expect(adminList.json.some((p: { key: string }) => p.key.startsWith("gift-walk-"))).toBe(false);
    const giftPlan = await db.plan.findFirstOrThrow({ where: { key: { startsWith: "gift-walk-" } } });
    const buy = await call(subscriptionsRoute.POST as H, { method: "POST", cookie: cookies.bea, body: { planId: giftPlan.id } });
    expect(buy.status).toBe(404);
  });

  test("walking on the gift pays the walker and does not reward again", async () => {
    const walletBefore = await walletBalance(ids.luis);
    const b = await book(ids.bea, cookies.bea, { paymentMethod: "PLAN", subscriptionId: ids.beaGift });
    expect(b.payment.method).toBe("PLAN");
    expect(b.payment.status).toBe("HELD");
    await walkIt(b.id);
    const sub = await db.subscription.findUniqueOrThrow({ where: { id: ids.beaGift } });
    expect(sub.walksUsed).toBe(1);
    expect(await accountBalance(`plan:${ids.beaGift}`)).toBe(0);
    expect(await walletBalance(ids.luis)).toBeGreaterThan(walletBefore);
    expect(await db.referral.count({ where: { referrerId: ids.ana, status: "REWARDED" } })).toBe(1);
    await expectLedgerBalanced();
  });

  test("an unused gift expires back to marketing, never to the owner (even on the credit policy)", async () => {
    const cfg = await getAppConfig();
    await updateConfigSection("plans", { unusedWalkPolicy: "credit" });
    try {
      await db.subscription.update({ where: { id: ids.anaGift }, data: { periodEnd: new Date(Date.now() - 1000) } });
      const marketingBefore = await accountBalance("platform:marketing");
      const ownerBefore = await accountBalance(`owner:${ids.ana}`);
      await expireSubscriptions();
      expect((await db.subscription.findUniqueOrThrow({ where: { id: ids.anaGift } })).status).toBe("EXPIRED");
      expect(await accountBalance(`plan:${ids.anaGift}`)).toBe(0);
      expect(await accountBalance("platform:marketing")).toBe(marketingBefore + cfg.pricing.price30Cents);
      expect(await accountBalance(`owner:${ids.ana}`)).toBe(ownerBefore);
    } finally {
      await updateConfigSection("plans", { unusedWalkPolicy: cfg.plans.unusedWalkPolicy });
    }
    await expectLedgerBalanced();
  });

  test("the referrer cap stops the referrer's reward, not the friend's", async () => {
    await updateConfigSection("referrals", { maxRewardsPerReferrer: 1 });
    try {
      // Cleo was referred by Ana too (redeemed above); Ana already earned 1.
      await makeBookable(ids.cleo);
      const b = await book(ids.cleo, cookies.cleo, { paymentMethod: "CASH" });
      await walkIt(b.id);
      const ref = await db.referral.findUniqueOrThrow({ where: { refereeId: ids.cleo } });
      expect(ref.status).toBe("REWARDED");
      expect(ref.refereeGiftId).toBeTruthy();
      expect(ref.referrerRewarded).toBe(false);
      expect(ref.referrerGiftId).toBeNull();
      const card = await call(referralsRoute.GET as H, { cookie: cookies.ana });
      expect(card.json.rewarded).toBe(1);
      expect(card.json.rewardsLeft).toBe(0);
      expect(card.json.invited).toBe(2);
    } finally {
      await updateConfigSection("referrals", { maxRewardsPerReferrer: 10 });
    }
    await expectLedgerBalanced();
  });
});

describe("admin: referrals", () => {
  test("lists referrals; only PENDING ones can be voided, with a reason", async () => {
    const s = await signUp({ referralCode: ids.anaCode });
    const list = await call(adminReferralsRoute.GET as H, { cookie: cookies.admin });
    expect(list.status).toBe(200);
    const pending = list.json.find((r: { refereeName: string; status: string }) => r.status === "PENDING");
    expect(pending).toBeTruthy();
    const noReason = await call(adminReferralRoute.PATCH as H, { method: "PATCH", params: { id: pending.id }, cookie: cookies.admin, body: { action: "void" } });
    expect(noReason.status).toBe(400);
    const v = await call(adminReferralRoute.PATCH as H, {
      method: "PATCH",
      params: { id: pending.id },
      cookie: cookies.admin,
      body: { action: "void", reason: "Misma persona" },
    });
    expect(v.status).toBe(200);
    expect((await db.referral.findUniqueOrThrow({ where: { refereeId: s.id } })).status).toBe("VOID");
    const rewarded = list.json.find((r: { status: string }) => r.status === "REWARDED");
    const again = await call(adminReferralRoute.PATCH as H, {
      method: "PATCH",
      params: { id: rewarded.id },
      cookie: cookies.admin,
      body: { action: "void", reason: "x" },
    });
    expect(again.status).toBe(400);
    expect((await call(adminReferralsRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);
  });

  test("referral config is validated", async () => {
    const bad = await call(configRoute.PATCH as H, {
      method: "PATCH",
      cookie: cookies.admin,
      body: { section: "referrals", patch: { giftDurationMin: 40 } },
    });
    expect(bad.status).toBe(400);
  });

  test("with referrals off, codes are not applied", async () => {
    await updateConfigSection("referrals", { enabled: 0 });
    try {
      const s = await signUp({ referralCode: ids.anaCode });
      expect(s.json.referral).toEqual({ applied: false });
    } finally {
      await updateConfigSection("referrals", { enabled: 1 });
    }
  });
});

describe("admin: import Phase-0 customers", () => {
  const rows = () => [
    { name: "Dora Concierge", phone: "6 999 0001", zone: "equipetrol", dogs: [{ name: "Pipo", size: "S" }] },
    { name: "Dora Concierge", phone: "+59169990001", dogs: [{ name: "Lola" }] }, // same phone → merged
    { name: "Eva Concierge", phone: "79990002", addressNote: "Edificio Sol", channel: "vet" },
    { name: "Ana repetida", phone: PHONES.ana },
    { name: "Fito", phone: "12", zone: "x" },
    { name: "Gina", phone: "79990003", zone: "Atlántida" },
  ];

  test("only admins can import", async () => {
    const r = await call(importRoute.POST as H, { method: "POST", cookie: cookies.ana, body: { rows: rows() } });
    expect(r.status).toBe(403);
  });

  test("dry run validates without writing", async () => {
    const zone = await db.zone.findFirstOrThrow({ where: { key: "equipetrol" } }).catch(() => null);
    const r = await call(importRoute.POST as H, { method: "POST", cookie: cookies.admin, body: { rows: rows(), dryRun: true } });
    expect(r.status).toBe(200);
    expect(r.json.dryRun).toBe(true);
    expect(r.json.created).toBe(0);
    expect(r.json.exists).toBe(1);
    // bad phone + unknown zone ("Atlántida"); "equipetrol" only if seeded
    expect(r.json.errors).toBe(zone ? 2 : 3);
    expect(await db.user.count({ where: { phone: "+59169990001" } })).toBe(0);
    const dora = r.json.rows.find((x: { phone: string }) => x.phone === "+59169990001");
    if (zone) {
      expect(dora.status).toBe("ready");
      expect(dora.dogs).toBe(2);
      expect(dora.inviteUrl).toStartWith("https://wa.me/59169990001?text=");
    }
  });

  test("import creates owners with their dogs, marked concierge", async () => {
    const r = await call(importRoute.POST as H, { method: "POST", cookie: cookies.admin, body: { rows: rows() } });
    expect(r.status).toBe(200);
    const eva = await db.user.findUniqueOrThrow({ where: { phone: "+59179990002" } });
    expect(eva.role).toBe("OWNER");
    expect(eva.acquisitionChannel).toBe("vet");
    expect(eva.importedAt).toBeTruthy();
    expect(eva.addressNote).toBe("Edificio Sol");
    expect(eva.termsVersion).toBeNull(); // accepted on first sign-in
    const dora = await db.user.findUnique({ where: { phone: "+59169990001" }, include: { dogs: true } });
    if (dora) {
      expect(dora.acquisitionChannel).toBe("concierge");
      expect(dora.dogs.map((d) => d.name).sort()).toEqual(["Lola", "Pipo"]);
    }
    // Re-running is safe: everyone already exists now.
    const again = await call(importRoute.POST as H, { method: "POST", cookie: cookies.admin, body: { rows: rows() } });
    expect(again.json.created).toBe(0);
  });
});

describe("admin: weekly growth metrics", () => {
  test("8 weeks, cohorts, channels and referrals", async () => {
    expect((await call(growthRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);
    const r = await call(growthRoute.GET as H, { cookie: cookies.admin });
    expect(r.status).toBe(200);
    const m = r.json;
    expect(m.weeks).toHaveLength(8);
    const thisWeek = m.weeks[7];
    expect(thisWeek.weekStart).toBe(boDateKey(boWeekStart(new Date())));
    expect(thisWeek.completedWalks).toBeGreaterThanOrEqual(3);
    expect(thisWeek.referralsRewarded).toBe(2);
    expect(thisWeek.onTimePct).toBeGreaterThan(0);
    expect(m.cohorts).toHaveLength(6);
    expect(m.cohorts[5].m2Pct).toBeNull();
    const channels = Object.fromEntries(m.channels.map((c: { channel: string; owners: number }) => [c.channel, c]));
    expect(channels.referral.owners).toBeGreaterThanOrEqual(2);
    expect(channels.referral.activated).toBeGreaterThanOrEqual(2);
    expect(channels.vet.owners).toBe(1);
    expect(m.referrals.rewarded).toBe(2);
    expect(m.referrals.void).toBe(1);
    expect(m.referrals.giftWalksIssued).toBe(3);
    expect(m.referrals.giftWalksUsed).toBe(1);
    expect(m.referrals.giftCostCents).toBe(-(await accountBalance("platform:marketing")));
    await expectLedgerBalanced();
  });
});
