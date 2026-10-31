/// <reference types="bun-types" />
// Milestone 6 — notifications & anti-disintermediation:
//   - every booking / walk / payment event sends the right WhatsApp template
//     (mock sender), in the user's language, plus the in-app notification
//   - per-channel preferences (WhatsApp opt-out, web push subscriptions)
//   - phone numbers of the other party never reach owners / walkers
//   - chat messages sharing a phone number or wa.me link are flagged

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import * as bookingsRoute from "@/app/api/bookings/route";
import * as bookingRoute from "@/app/api/bookings/[id]/route";
import * as walkRoute from "@/app/api/walks/[id]/route";
import * as qrRoute from "@/app/api/payments/[id]/qr/route";
import * as webhookRoute from "@/app/api/payments/webhook/[provider]/route";
import * as payoutsRoute from "@/app/api/payouts/route";
import * as payoutRoute from "@/app/api/payouts/[id]/route";
import * as messagesRoute from "@/app/api/messages/route";
import * as prefsRoute from "@/app/api/notifications/preferences/route";
import * as pushRoute from "@/app/api/notifications/push/route";
import * as adminBookingsRoute from "@/app/api/admin/bookings/route";
import * as cronDaily from "@/app/api/cron/daily/route";
import { MOCK_SIGNATURE_HEADER, MockProvider } from "@/lib/server/payments/mockProvider";
import { remindExpiringSubscriptions } from "@/lib/server/payments/plans";
import { notify } from "@/lib/server/notify";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import {
  clearMockOutbox,
  MockPushSender,
  MockWhatsAppSender,
  mockOutbox,
  setChannelsForTests,
} from "@/lib/server/notifications/channels";
import { renderTemplate, TEMPLATE_KEYS, type TemplateVars } from "@/lib/server/notifications/templates";
import { containsContactInfo } from "@/lib/firu/contactGuard";
import { call, cookieFor, PHONES, userId } from "./helpers";

type H = Parameters<typeof call>[0];
const mock = new MockProvider();
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

function dayAhead(days: number): string {
  return new Date(Date.now() - 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** WhatsApp messages the mock sender got, optionally for one template. */
function whatsapps(template?: string) {
  return mockOutbox().filter(
    (m): m is Extract<(typeof m), { channel: "whatsapp" }> =>
      m.channel === "whatsapp" && (!template || m.template === template)
  );
}

async function setPrefs(who: string, body: Record<string, unknown>) {
  const r = await call(prefsRoute.PATCH as H, { method: "PATCH", cookie: cookies[who], body });
  expect(r.status).toBe(200);
  return r.json;
}

async function book(owner: "ana" | "carlos", paymentMethod: "QR" | "CASH" = "QR", day = 2, minute = 600) {
  const ownerUser = await db.user.findUniqueOrThrow({ where: { phone: PHONES[owner] }, include: { dogs: true } });
  const r = await call(bookingsRoute.POST as H, {
    method: "POST",
    cookie: cookies[owner],
    body: {
      dogId: ownerUser.dogs[0].id,
      zoneId: ownerUser.zoneId,
      type: "ONE_OFF",
      durationMin: 30,
      schedule: [{ date: dayAhead(day), minute }],
      preferredWalkerUserId: ids.luis,
      paymentMethod,
    },
  });
  expect(r.status).toBe(201);
  return r.json as { id: string; payment: { id: string } };
}

function walkPatch(walkId: string, who: string, body: Record<string, unknown>) {
  return call(walkRoute.PATCH as H, { method: "PATCH", params: { id: walkId }, cookie: cookies[who], body });
}

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  setChannelsForTests({ whatsapp: new MockWhatsAppSender(), push: new MockPushSender() });
  for (const k of ["admin", "ana", "carlos", "luis"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
});

beforeEach(() => clearMockOutbox());

afterAll(async () => {
  setRealtimePublisherForTests(null);
  setChannelsForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

// ---------------------------------------------------------------------------

describe("templates", () => {
  const sample: { [K in (typeof TEMPLATE_KEYS)[number]]: TemplateVars[K] } = {
    booking_request: {
      ownerName: "Ana Pérez", dogName: "Max", zoneName: "Equipetrol",
      schedule: [{ day: 1, minute: 450 }, { day: 3, minute: 450 }], bookingType: "RECURRING",
      durationMin: 30, acceptSeconds: 90,
    },
    booking_confirmed: {
      walkerName: "Luis", dogName: "Max", schedule: [{ date: "2026-11-05", minute: 600 }],
      bookingType: "ONE_OFF", payment: "QR",
    },
    walker_on_the_way: { walkerName: "Luis", dogName: "Max", walkId: "w1" },
    walk_started: { walkerName: "Luis", dogName: "Max", walkId: "w1" },
    walk_finished: { walkerName: "Luis", dogName: "Max", walkId: "w1", hasTrack: true, cashCents: 1500 },
    payment_received: { amountCents: 1575, dogName: "Max" },
    payout_sent: { amountCents: 12000, method: "BANK", reference: "TRX-1" },
    plan_expiring: { planName: "Plan 20", periodEnd: new Date("2026-11-30T15:00:00Z"), walksLeft: 4 },
  };
  const docs = readFileSync("docs/WHATSAPP_TEMPLATES.md", "utf8");

  test("every event renders in ES and EN with the parameter count documented for Meta", () => {
    for (const key of TEMPLATE_KEYS) {
      const es = renderTemplate(key, sample[key] as never, { locale: "es", appUrl: "https://firu.test" });
      const en = renderTemplate(key, sample[key] as never, { locale: "en", appUrl: "https://firu.test" });
      expect(es.waTemplate).toBe(`firuwalk_${key}`);
      expect(en.waTemplate).toBe(es.waTemplate);
      expect(es.title).not.toBe(en.title);
      expect(es.waParams.every((p) => p.length > 0)).toBe(true);
      // The docs section for this template lists exactly as many {{n}} as we send.
      const section = docs.split(`## ${es.waTemplate}`)[1]?.split("\n## ")[0] ?? "";
      for (const lang of ["es", "en"]) {
        const line = section.split("\n").find((l) => l.startsWith(`- **${lang}:**`)) ?? "";
        const n = new Set(line.match(/\{\{\d+\}\}/g) ?? []).size;
        expect(n).toBe(es.waParams.length);
      }
    }
  });

  test("links and dates are localized", () => {
    const es = renderTemplate("walk_finished", sample.walk_finished, { locale: "es", appUrl: "https://firu.test/" });
    expect(es.waParams[2]).toBe("https://firu.test/?walk=w1");
    expect(es.body).toContain("Bs 15,00");
    const en = renderTemplate("walk_finished", sample.walk_finished, { locale: "en", appUrl: "https://firu.test" });
    expect(en.body).toContain("Bs 15.00");
    const req = renderTemplate("booking_request", sample.booking_request, { locale: "en", appUrl: "" });
    expect(req.waParams[3]).toBe("Mon/Wed 07:30");
    const conf = renderTemplate("booking_confirmed", sample.booking_confirmed, { locale: "es", appUrl: "" });
    expect(conf.waParams[2]).toBe("05/11 10:00");
    const plan = renderTemplate("plan_expiring", sample.plan_expiring, { locale: "es", appUrl: "" });
    expect(plan.waParams[1]).toBe("30/11/2026");
  });
});

// ---------------------------------------------------------------------------

describe("booking and walk events send the right template", () => {
  test("booking request → walker gets firuwalk_booking_request (+ in-app + delivery log)", async () => {
    const before = await db.notification.count({ where: { userId: ids.luis } });
    const b = await book("ana", "QR");
    ids.booking = b.id;
    ids.payment = b.payment.id;

    const sent = whatsapps("firuwalk_booking_request");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONES.luis);
    expect(sent[0].language).toBe("es");
    const ana = await db.user.findUniqueOrThrow({ where: { id: ids.ana }, include: { dogs: true } });
    expect(sent[0].params[0]).toBe(ana.name.split(" ")[0]);
    expect(sent[0].params[1]).toBe(ana.dogs[0].name);

    expect(await db.notification.count({ where: { userId: ids.luis } })).toBe(before + 1);
    const deliveries = await db.notificationDelivery.findMany({
      where: { userId: ids.luis, template: "booking_request" },
    });
    expect(deliveries.map((d) => `${d.channel}:${d.status}`).sort()).toEqual(["IN_APP:SENT", "WHATSAPP:SENT"]);
  });

  test("accept → owner gets firuwalk_booking_confirmed", async () => {
    const r = await call(bookingRoute.PATCH as H, {
      method: "PATCH", params: { id: ids.booking }, cookie: cookies.luis, body: { action: "accept" },
    });
    expect(r.status).toBe(200);
    const sent = whatsapps("firuwalk_booking_confirmed");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONES.ana);
    const walk = await db.walk.findFirstOrThrow({ where: { bookingId: ids.booking, status: "SCHEDULED" } });
    ids.walk = walk.id;
  });

  test("payment confirmed by the bank → owner gets firuwalk_payment_received", async () => {
    await call(qrRoute.POST as H, { method: "POST", params: { id: ids.payment }, cookie: cookies.ana, body: {} });
    const p = await db.payment.findUniqueOrThrow({ where: { id: ids.payment } });
    const { rawBody, signature } = await mock.pay(p.providerRef!);
    const r = await call(webhookRoute.POST as unknown as H, {
      method: "POST",
      params: { provider: "mock" },
      headers: { [MOCK_SIGNATURE_HEADER]: signature, "content-type": "application/json" },
      body: JSON.parse(rawBody),
    });
    expect(r.status).toBe(200);
    const sent = whatsapps("firuwalk_payment_received");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONES.ana);
    expect(sent[0].params[0]).toMatch(/^Bs \d/);
  });

  test("'on my way' → owner gets firuwalk_walker_on_the_way, once; only the walker can send it", async () => {
    // Too early: more than an hour before the walk.
    const early = await walkPatch(ids.walk, "luis", { action: "on_the_way" });
    expect(early.status).toBe(400);
    expect(whatsapps()).toHaveLength(0);

    await db.walk.update({ where: { id: ids.walk }, data: { scheduledStart: new Date(Date.now() + 20 * 60_000) } });
    const owner = await walkPatch(ids.walk, "ana", { action: "on_the_way" });
    expect(owner.status).toBe(403);

    const first = await walkPatch(ids.walk, "luis", { action: "on_the_way" });
    expect(first.status).toBe(200);
    expect(first.json.onTheWayAt).toBeTruthy();
    const again = await walkPatch(ids.walk, "luis", { action: "on_the_way" });
    expect(again.status).toBe(200);
    const sent = whatsapps("firuwalk_walker_on_the_way");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONES.ana);
  });

  test("start → firuwalk_walk_started with a live link; finish → firuwalk_walk_finished with the report link", async () => {
    const ana = await db.user.findUniqueOrThrow({ where: { id: ids.ana } });
    const pos = { lat: ana.addressLat!, lng: ana.addressLng!, acc: 5 };
    expect((await walkPatch(ids.walk, "luis", { action: "start", ...pos })).status).toBe(200);
    const started = whatsapps("firuwalk_walk_started");
    expect(started).toHaveLength(1);
    expect(started[0].params[2]).toEndWith(`/?walk=${ids.walk}`);

    const fin = await walkPatch(ids.walk, "luis", {
      action: "finish", ...pos, report: { note: "Todo bien", pee: true, poo: true },
    });
    expect(fin.status).toBe(200);
    const finished = whatsapps("firuwalk_walk_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0].to).toBe(PHONES.ana);
    expect(finished[0].params[2]).toEndWith(`/?walk=${ids.walk}`);
  });

  test("payout marked paid → walker gets firuwalk_payout_sent with the bank reference", async () => {
    await db.walkerProfile.update({
      where: { userId: ids.luis },
      data: { payoutMethod: "BANK", payoutBank: "BNB", payoutAccount: "1234567", payoutHolder: "Luis" },
    });
    const req = await call(payoutsRoute.POST as H, { method: "POST", cookie: cookies.luis, body: {} });
    expect(req.status).toBe(201);
    clearMockOutbox();
    const paid = await call(payoutRoute.PATCH as H, {
      method: "PATCH", params: { id: req.json.id }, cookie: cookies.admin, body: { action: "paid", reference: "TRX-777" },
    });
    expect(paid.status).toBe(200);
    const sent = whatsapps("firuwalk_payout_sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONES.luis);
    expect(sent[0].params[1]).toBe("TRX-777");
  });

  test("plan ending soon → firuwalk_plan_expiring, once per period (daily job)", async () => {
    const plan = await db.plan.findFirstOrThrow({ where: { active: true } });
    const sub = await db.subscription.create({
      data: {
        ownerId: ids.carlos, planId: plan.id, status: "ACTIVE",
        walksTotal: plan.walks, walksUsed: 2, durationMin: plan.durationMin, priceCents: plan.priceCents,
        periodStart: new Date(Date.now() - 28 * 86_400_000),
        periodEnd: new Date(Date.now() + 2 * 86_400_000),
      },
    });
    process.env.CRON_SECRET = "cron-secret-for-tests-0123";
    const r = await call(cronDaily.GET as H, { headers: { authorization: "Bearer cron-secret-for-tests-0123" } });
    expect(r.status).toBe(200);
    expect(r.json.plansReminded).toBeGreaterThanOrEqual(1);
    const sent = whatsapps("firuwalk_plan_expiring").filter((m) => m.to === PHONES.carlos);
    expect(sent).toHaveLength(1);
    expect(sent[0].params).toEqual([plan.name, expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/), String(plan.walks - 2)]);

    expect(await remindExpiringSubscriptions()).toBe(0);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).expiryRemindedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("channel preferences", () => {
  test("defaults: WhatsApp and push on, Spanish", async () => {
    const r = await call(prefsRoute.GET as H, { cookie: cookies.carlos });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ whatsapp: true, push: true, locale: "es", whatsappAvailable: true });
  });

  test("invalid values are rejected", async () => {
    const r = await call(prefsRoute.PATCH as H, { method: "PATCH", cookie: cookies.carlos, body: { locale: "fr" } });
    expect(r.status).toBe(400);
    const u = await call(prefsRoute.PATCH as H, { method: "PATCH", cookie: cookies.carlos, body: { whatsapp: "yes" } });
    expect(u.status).toBe(400);
    const anon = await call(prefsRoute.GET as H, {});
    expect(anon.status).toBe(401);
  });

  test("English speakers get the English template and in-app text", async () => {
    await setPrefs("luis", { locale: "en" });
    await book("carlos", "CASH", 4, 540);
    const sent = whatsapps("firuwalk_booking_request");
    expect(sent).toHaveLength(1);
    expect(sent[0].language).toBe("en");
    const n = await db.notification.findFirstOrThrow({ where: { userId: ids.luis }, orderBy: { createdAt: "desc" } });
    expect(n.title).toBe("New booking request ⏳");
    await setPrefs("luis", { locale: "es" });
  });

  test("opting out of WhatsApp keeps the in-app notification and logs SKIPPED", async () => {
    await setPrefs("carlos", { whatsapp: false });
    const booking = await db.booking.findFirstOrThrow({
      where: { ownerId: ids.carlos, status: "REQUESTED" },
      orderBy: { requestedAt: "desc" },
    });
    const r = await call(bookingRoute.PATCH as H, {
      method: "PATCH", params: { id: booking.id }, cookie: cookies.luis, body: { action: "accept" },
    });
    expect(r.status).toBe(200);
    expect(whatsapps()).toHaveLength(0);
    const d = await db.notificationDelivery.findMany({
      where: { userId: ids.carlos, template: "booking_confirmed" },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    expect(d.map((x) => `${x.channel}:${x.status}`).sort()).toEqual(["IN_APP:SENT", "WHATSAPP:SKIPPED"]);
    await setPrefs("carlos", { whatsapp: true });
  });

  test("without a WhatsApp provider the event is still delivered in-app", async () => {
    setChannelsForTests({ whatsapp: null, push: new MockPushSender() });
    try {
      const before = await db.notification.count({ where: { userId: ids.luis } });
      await book("ana", "CASH", 5, 540);
      expect(await db.notification.count({ where: { userId: ids.luis } })).toBe(before + 1);
      const last = await db.notificationDelivery.findFirstOrThrow({
        where: { userId: ids.luis, channel: "WHATSAPP" },
        orderBy: { createdAt: "desc" },
      });
      expect(last.status).toBe("SKIPPED");
    } finally {
      setChannelsForTests({ whatsapp: new MockWhatsAppSender(), push: new MockPushSender() });
    }
  });

  test("the real WhatsApp sender never messages seeded demo phones", async () => {
    let calls = 0;
    setChannelsForTests({ whatsapp: { name: "cloud", send: async () => { calls++; return { messageId: "x" }; } }, push: null });
    try {
      await notify(ids.luis, "SYSTEM", "x", "y"); // free text: never WhatsApp
      const { notifyEvent } = await import("@/lib/server/notify");
      await notifyEvent(ids.luis, "payout_sent", { amountCents: 100, method: "QR", reference: "R1" });
      expect(calls).toBe(0);
      const last = await db.notificationDelivery.findFirstOrThrow({
        where: { userId: ids.luis, channel: "WHATSAPP" },
        orderBy: { createdAt: "desc" },
      });
      expect(last.status).toBe("SKIPPED");
    } finally {
      setChannelsForTests({ whatsapp: new MockWhatsAppSender(), push: new MockPushSender() });
    }
  });

  test("a failing WhatsApp provider never fails the request", async () => {
    setChannelsForTests({
      whatsapp: { name: "mock", send: async () => { throw new Error("WhatsApp Cloud API responded 500"); } },
      push: new MockPushSender(),
    });
    try {
      const ana = await db.user.findUniqueOrThrow({ where: { id: ids.ana }, include: { dogs: true } });
      const r = await call(bookingsRoute.POST as H, {
        method: "POST",
        cookie: cookies.ana,
        body: {
          dogId: ana.dogs[0].id, zoneId: ana.zoneId, type: "ONE_OFF", durationMin: 30,
          schedule: [{ date: dayAhead(3), minute: 660 }], preferredWalkerUserId: ids.luis, paymentMethod: "CASH",
        },
      });
      expect(r.status).toBe(201);
      const last = await db.notificationDelivery.findFirstOrThrow({
        where: { userId: ids.luis, channel: "WHATSAPP" },
        orderBy: { createdAt: "desc" },
      });
      expect(last.status).toBe("FAILED");
    } finally {
      setChannelsForTests({ whatsapp: new MockWhatsAppSender(), push: new MockPushSender() });
    }
  });
});

describe("web push", () => {
  const sub = {
    endpoint: "https://push.example.com/send/abc123",
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
  };

  test("subscriptions are validated and owned by the caller", async () => {
    const bad = await call(pushRoute.POST as H, {
      method: "POST", cookie: cookies.ana, body: { ...sub, endpoint: "http://insecure.example.com/x" },
    });
    expect(bad.status).toBe(400);
    const anon = await call(pushRoute.POST as H, { method: "POST", body: sub });
    expect(anon.status).toBe(401);

    const ok = await call(pushRoute.POST as H, { method: "POST", cookie: cookies.ana, body: sub });
    expect(ok.status).toBe(201);
    expect(ok.json.devices).toBe(1);

    // Someone else cannot remove Ana's subscription.
    await call(pushRoute.DELETE as H, { method: "DELETE", cookie: cookies.carlos, body: { endpoint: sub.endpoint } });
    expect(await db.pushSubscription.count({ where: { endpoint: sub.endpoint, userId: ids.ana } })).toBe(1);
  });

  test("notifications are pushed to subscribed browsers; gone subscriptions are removed", async () => {
    await db.pushSubscription.create({
      data: { userId: ids.ana, endpoint: "https://push.example.com/gone/1", p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    const booking = await db.booking.findFirstOrThrow({
      where: { ownerId: ids.ana, status: "REQUESTED" },
      orderBy: { requestedAt: "desc" },
    });
    await call(bookingRoute.PATCH as H, {
      method: "PATCH", params: { id: booking.id }, cookie: cookies.luis, body: { action: "accept" },
    });
    const pushes = mockOutbox().filter((m) => m.channel === "push");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ endpoint: sub.endpoint, title: "¡Reserva confirmada! ✅" });
    expect(await db.pushSubscription.count({ where: { endpoint: "https://push.example.com/gone/1" } })).toBe(0);
  });

  test("turning push off stops pushes; unsubscribing removes the device", async () => {
    await setPrefs("ana", { push: false });
    await notify(ids.ana, "SYSTEM", "Prueba", "Sin push");
    expect(mockOutbox().filter((m) => m.channel === "push")).toHaveLength(0);
    await setPrefs("ana", { push: true });
    await notify(ids.ana, "SYSTEM", "Prueba", "Con push");
    expect(mockOutbox().filter((m) => m.channel === "push")).toHaveLength(1);

    const del = await call(pushRoute.DELETE as H, { method: "DELETE", cookie: cookies.ana, body: { endpoint: sub.endpoint } });
    expect(del.status).toBe(200);
    expect(del.json.devices).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("anti-disintermediation", () => {
  test("owners and walkers never receive each other's phone number; admins do", async () => {
    const r = await call(bookingRoute.GET as H, { params: { id: ids.booking }, cookie: cookies.ana });
    expect(r.status).toBe(200);
    expect(r.json.walker.phone).toBeUndefined();
    expect(JSON.stringify(r.json)).not.toContain(PHONES.luis);

    const w = await call(walkRoute.GET as H, { params: { id: ids.walk }, cookie: cookies.luis });
    expect(w.status).toBe(200);
    expect(JSON.stringify(w.json)).not.toContain(PHONES.ana);

    const list = await call(bookingsRoute.GET as H, { cookie: cookies.luis });
    expect(JSON.stringify(list.json)).not.toContain(PHONES.ana);

    const admin = await call(adminBookingsRoute.GET as H, { cookie: cookies.admin });
    const mine = admin.json.find((b: { id: string }) => b.id === ids.booking);
    expect(mine.owner.phone).toBe(PHONES.ana);
    expect(mine.walker.phone).toBe(PHONES.luis);
  });

  test("detector: phone numbers and WhatsApp links, not times, prices or dates", () => {
    for (const t of ["mi cel 77123456", "+591 7712-3456", "wa.me/59177123456", "https://api.whatsapp.com/send?phone=1"]) {
      expect(containsContactInfo(t)).toBe(true);
    }
    for (const t of ["llego 17:30", "son Bs 150", "el 25/10", "el 2026-10-25", "Max hizo pis 2 veces"]) {
      expect(containsContactInfo(t)).toBe(false);
    }
  });

  test("chat messages sharing a number are delivered but flagged", async () => {
    const published: unknown[] = [];
    setRealtimePublisherForTests(async (_room, _event, data) => {
      published.push(data);
    });
    try {
      const flagged = await call(messagesRoute.POST as H, {
        method: "POST", cookie: cookies.ana, body: { threadId: ids.booking, body: "Escríbeme al 7712 3456 mejor" },
      });
      expect(flagged.status).toBe(201);
      expect(flagged.json.contactFlag).toBe(true);
      expect(published.at(-1)).toMatchObject({ contactFlag: true });

      const clean = await call(messagesRoute.POST as H, {
        method: "POST", cookie: cookies.luis, body: { threadId: ids.booking, body: "Llego a las 10:00 🐾" },
      });
      expect(clean.status).toBe(201);
      expect(clean.json.contactFlag).toBe(false);

      const history = await call(messagesRoute.GET as H, { path: `/api/messages?threadId=${ids.booking}`, cookie: cookies.luis });
      expect(history.json.filter((m: { contactFlag: boolean }) => m.contactFlag)).toHaveLength(1);
    } finally {
      setRealtimePublisherForTests(async () => {});
    }
  });
});
