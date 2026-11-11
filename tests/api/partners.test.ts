/// <reference types="bun-types" />
// Phase 3 (growth): partner codes (vets, shops, condos…), the partner's fee
// accrued in the ledger and paid out, zone peak-hour utilization, and the
// SEO routes. The ledger must still balance.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as mockPayRoute from "@/app/api/payments/mock/pay/route";
import * as partnersRoute from "@/app/api/admin/partners/route";
import * as partnerRoute from "@/app/api/admin/partners/[id]/route";
import * as partnerPayoutRoute from "@/app/api/admin/partners/[id]/payout/route";
import * as partnerQrRoute from "@/app/api/admin/partners/[id]/qr/route";
import * as referralsRoute from "@/app/api/referrals/route";
import * as redeemRoute from "@/app/api/referrals/redeem/route";
import * as growthRoute from "@/app/api/admin/metrics/growth/route";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { setOtpSendersForTests } from "@/lib/server/auth/otpSenders";
import { getAppConfig, updateConfigSection } from "@/lib/server/config";
import { accountBalance } from "@/lib/server/ledger";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { PEAK_WINDOWS, zoneUtilization } from "@/lib/server/growthMetrics";
import { call, cookieFor, PHONES, userId } from "./helpers";
import { book, CaptureSender, expectLedgerBalanced, makeBookable, signUp, walkIt, type H } from "./flows";

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const sender = new CaptureSender();
const FEE = 1000; // Bs 10 per activated client

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  setOtpSendersForTests([sender]);
  process.env.DEMO_MODE = "false";
  await db.rateLimit.deleteMany();
  for (const k of ["admin", "ana", "luis"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
  await updateConfigSection("referrals", { enabled: 1, giftDurationMin: 30 });
});

afterAll(async () => {
  setOtpSendersForTests(null);
  setRealtimePublisherForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

describe("admin: partners", () => {
  test("only admins manage partners", async () => {
    expect((await call(partnersRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);
    const r = await call(partnersRoute.POST as H, { method: "POST", cookie: cookies.ana, body: { name: "X", kind: "VET", giftWalk: true } });
    expect(r.status).toBe(403);
  });

  test("create with a chosen code; codes are unique across owners and partners", async () => {
    const r = await call(partnersRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { name: "Veterinaria San Roque", kind: "VET", code: "vet-roque", referralFeeCents: FEE, contactName: "Dra. Paz" },
    });
    expect(r.status).toBe(201);
    expect(r.json.code).toBe("VETROQUE");
    expect(r.json.giftWalk).toBe(true);
    expect(r.json.shareUrl).toEndWith("/?ref=VETROQUE");
    ids.vet = r.json.id;

    const dup = await call(partnersRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { name: "Otra", kind: "PETSHOP", code: "VETROQUE" },
    });
    expect(dup.status).toBe(400);

    // An owner's referral code can't be taken by a partner.
    const anaCode = (await call(referralsRoute.GET as H, { cookie: cookies.ana })).json.code;
    const clash = await call(partnersRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { name: "Clash", kind: "OTHER", code: anaCode },
    });
    expect(clash.status).toBe(400);
  });

  test("a code is generated when none is given; a condo can skip the welcome walk", async () => {
    const r = await call(partnersRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { name: "Condominio Las Palmas", kind: "CONDO", giftWalk: false },
    });
    expect(r.status).toBe(201);
    expect(r.json.code).toMatch(/^CONDOM\d{2}$/);
    ids.condo = r.json.id;
    ids.condoCode = r.json.code;
  });

  test("the printable QR is a PNG of the share link", async () => {
    const r = await call(partnerQrRoute.GET as H, { cookie: cookies.admin, params: { id: ids.vet } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toBe("image/png");
    expect((await call(partnerQrRoute.GET as H, { cookie: cookies.ana, params: { id: ids.vet } })).status).toBe(403);
  });
});

describe("owners signing up with a partner code", () => {
  test("the code links the owner to the partner; channel follows the partner kind", async () => {
    const s = await signUp(sender, 3, { referralCode: "vet roque", channel: "instagram" });
    expect(s.json.referral).toEqual({ applied: true });
    const u = await db.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(u.partnerId).toBe(ids.vet);
    expect(u.acquisitionChannel).toBe("vet");
    ids.owner = s.id;
    cookies.owner = s.cookie;

    const card = await call(referralsRoute.GET as H, { cookie: s.cookie });
    expect(card.json.canRedeem).toBe(false);
    expect(card.json.referredBy).toEqual({ status: "PENDING", partnerName: "Veterinaria San Roque" });
  });

  test("an owner with a partner cannot also use a friend's code", async () => {
    const anaCode = (await call(referralsRoute.GET as H, { cookie: cookies.ana })).json.code;
    const r = await call(redeemRoute.POST as H, { method: "POST", cookie: cookies.owner, body: { code: anaCode } });
    expect(r.status).toBe(400);
  });

  test("a paused partner's code is not applied", async () => {
    await call(partnerRoute.PATCH as H, { method: "PATCH", cookie: cookies.admin, params: { id: ids.condo }, body: { active: false } });
    const s = await signUp(sender, 3, { referralCode: ids.condoCode });
    expect(s.json.referral).toEqual({ applied: false });
    await call(partnerRoute.PATCH as H, { method: "PATCH", cookie: cookies.admin, params: { id: ids.condo }, body: { active: true } });
  });

  test("partner codes work even with owner-to-owner invites off", async () => {
    await updateConfigSection("referrals", { enabled: 0 });
    try {
      const s = await signUp(sender, 3, { referralCode: ids.condoCode });
      expect(s.json.referral).toEqual({ applied: true });
      ids.condoOwner = s.id;
      cookies.condoOwner = s.cookie;
    } finally {
      await updateConfigSection("referrals", { enabled: 1 });
    }
  });
});

describe("first paid walk", () => {
  test("the owner gets the welcome walk and the partner accrues its fee", async () => {
    await makeBookable(ids.owner);
    const marketingBefore = await accountBalance("platform:marketing");
    const b = await book(ids.owner, cookies.owner, ids.luis, { paymentMethod: "QR" });
    await call(mockPayRoute.POST as H, { method: "POST", cookie: cookies.owner, body: { paymentId: b.payment.id } });
    await walkIt(b.id, cookies.luis);

    const u = await db.user.findUniqueOrThrow({ where: { id: ids.owner } });
    expect(u.partnerRewardedAt).toBeTruthy();
    const gift = await db.subscription.findFirstOrThrow({ where: { ownerId: ids.owner, gift: true } });
    const value = (await getAppConfig()).pricing.price30Cents;
    expect(await accountBalance(`plan:${gift.id}`)).toBe(value);
    expect(await accountBalance(`partner:${ids.vet}`)).toBe(FEE);
    expect(await accountBalance("platform:marketing")).toBe(marketingBefore - value - FEE);
    await expectLedgerBalanced();
  });

  test("a second walk does not pay the partner again", async () => {
    const b = await book(ids.owner, cookies.owner, ids.luis, { paymentMethod: "CASH" });
    await walkIt(b.id, cookies.luis);
    expect(await accountBalance(`partner:${ids.vet}`)).toBe(FEE);
    expect(await db.subscription.count({ where: { ownerId: ids.owner, gift: true } })).toBe(1);
  });

  test("a partner without welcome walk: no gift, fee 0 → nothing moves", async () => {
    await makeBookable(ids.condoOwner);
    const b = await book(ids.condoOwner, cookies.condoOwner, ids.luis, { paymentMethod: "CASH" });
    await walkIt(b.id, cookies.luis);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.condoOwner } })).partnerRewardedAt).toBeTruthy();
    expect(await db.subscription.count({ where: { ownerId: ids.condoOwner, gift: true } })).toBe(0);
    expect(await accountBalance(`partner:${ids.condo}`)).toBe(0);
    await expectLedgerBalanced();
  });

  test("the partner list shows the funnel and what is owed", async () => {
    const r = await call(partnersRoute.GET as H, { cookie: cookies.admin });
    const vet = r.json.find((p: { id: string }) => p.id === ids.vet);
    expect(vet.owners).toBe(1);
    expect(vet.activated).toBe(1);
    expect(vet.walks).toBe(2);
    expect(vet.earnedCents).toBe(FEE);
    expect(vet.owedCents).toBe(FEE);
  });
});

describe("paying a partner", () => {
  test("needs a reference; pays the whole balance once", async () => {
    const noRef = await call(partnerPayoutRoute.POST as H, { method: "POST", cookie: cookies.admin, params: { id: ids.vet }, body: {} });
    expect(noRef.status).toBe(400);
    const cashBefore = await accountBalance("platform:cash");
    const r = await call(partnerPayoutRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      params: { id: ids.vet },
      body: { reference: "TRF-123" },
    });
    expect(r.status).toBe(200);
    expect(r.json.paidCents).toBe(FEE);
    expect(await accountBalance(`partner:${ids.vet}`)).toBe(0);
    expect(await accountBalance("platform:cash")).toBe(cashBefore + FEE);
    const again = await call(partnerPayoutRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      params: { id: ids.vet },
      body: { reference: "TRF-124" },
    });
    expect(again.status).toBe(400);
    const list = await call(partnersRoute.GET as H, { cookie: cookies.admin });
    const vet = list.json.find((p: { id: string }) => p.id === ids.vet);
    expect(vet.owedCents).toBe(0);
    expect(vet.earnedCents).toBe(FEE);
    await expectLedgerBalanced();
  });
});

describe("zone peak-hour utilization", () => {
  test("peak windows are 06:00–09:00 and 17:30–20:00", () => {
    expect(PEAK_WINDOWS).toEqual([
      [360, 540],
      [1050, 1200],
    ]);
  });

  test("booked peak minutes ÷ walker peak capacity, flagged at 70 %", async () => {
    const zone = await db.zone.findFirstOrThrow({ where: { key: "las-palmas" } });
    const profiles = await db.walkerProfile.findMany({ where: { zoneId: zone.id, status: "ACTIVE" }, include: { availabilities: true } });
    const rows = await zoneUtilization();
    const row = rows.find((z) => z.zoneId === zone.id)!;
    expect(row.activeWalkers).toBe(profiles.length);
    expect(row.peakUtilizationPct).toBeGreaterThanOrEqual(0);
    expect(row.readyToExpand).toBe(row.peakCapacityMin > 0 && row.peakUtilizationPct >= 70);

    const g = await call(growthRoute.GET as H, { cookie: cookies.admin });
    expect(g.json.expandThresholdPct).toBe(70);
    expect(g.json.zones.length).toBe(await db.zone.count({ where: { active: true } }));
    const channels = Object.fromEntries(g.json.channels.map((c: { channel: string; owners: number }) => [c.channel, c.owners]));
    expect(channels.vet).toBeGreaterThanOrEqual(1);
    expect(channels.condo).toBeGreaterThanOrEqual(1);
  });

  test("a walk at 07:00 inside a zone's capacity raises its occupancy", async () => {
    const zone = await db.zone.findFirstOrThrow({ where: { key: "equipetrol" } });
    const before = (await zoneUtilization()).find((z) => z.zoneId === zone.id)!;
    const template = await db.walk.findFirstOrThrow({ where: { zoneId: zone.id } });
    // Yesterday 07:00 Bolivia = 11:00 UTC.
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 1);
    start.setUTCHours(11, 0, 0, 0);
    await db.walk.create({
      data: {
        bookingId: template.bookingId,
        walkerId: template.walkerId,
        ownerId: template.ownerId,
        dogId: template.dogId,
        zoneId: zone.id,
        status: "COMPLETED",
        scheduledStart: start,
        durationMin: 60,
      },
    });
    const after = (await zoneUtilization()).find((z) => z.zoneId === zone.id)!;
    expect(after.peakBookedMin).toBe(before.peakBookedMin + 60);
  });
});

describe("SEO routes", () => {
  test("sitemap lists the landing and every legal page; robots keeps crawlers out of the API", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/"))).toBe(true);
    expect(urls.filter((u) => u.includes("/legal/"))).toHaveLength(4);
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.disallow).toEqual(["/api/"]);
    expect(String(r.sitemap)).toEndWith("/sitemap.xml");
  });
});
