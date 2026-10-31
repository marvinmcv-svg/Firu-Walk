/// <reference types="bun-types" />
// Authorization: every protected route rejects anonymous callers, wrong roles,
// and users acting on someone else's data.

import { beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as adminBookings from "@/app/api/admin/bookings/route";
import * as adminConfig from "@/app/api/admin/config/route";
import * as adminExport from "@/app/api/admin/export/route";
import * as adminMetrics from "@/app/api/admin/metrics/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as adminWalker from "@/app/api/admin/walkers/[id]/route";
import * as adminWalkers from "@/app/api/admin/walkers/route";
import * as booking from "@/app/api/bookings/[id]/route";
import * as bookings from "@/app/api/bookings/route";
import * as dispute from "@/app/api/disputes/[id]/route";
import * as disputes from "@/app/api/disputes/route";
import * as dog from "@/app/api/dogs/[id]/route";
import * as dogs from "@/app/api/dogs/route";
import * as messages from "@/app/api/messages/route";
import * as notifications from "@/app/api/notifications/route";
import * as paymentConfirm from "@/app/api/payments/[id]/confirm/route";
import * as payments from "@/app/api/payments/route";
import * as payout from "@/app/api/payouts/[id]/route";
import * as payouts from "@/app/api/payouts/route";
import * as realtimeToken from "@/app/api/realtime/token/route";
import * as reviews from "@/app/api/reviews/route";
import * as me from "@/app/api/users/me/route";
import * as walkerDetail from "@/app/api/walkers/[id]/route";
import * as walkerMatch from "@/app/api/walkers/match/route";
import * as walk from "@/app/api/walks/[id]/route";
import * as walkTrack from "@/app/api/walks/[id]/track/route";
import * as walks from "@/app/api/walks/route";
import * as wallet from "@/app/api/wallet/route";
import { call, cookieFor, PHONES, userId } from "./helpers";

type H = Parameters<typeof call>[0];
const P = { id: "does-not-matter" };

/** Every non-public handler, called with no session, must answer 401. */
const PROTECTED: [string, H, string, Record<string, string>?][] = [
  ["GET /admin/bookings", adminBookings.GET as H, "GET"],
  ["PATCH /admin/config", adminConfig.PATCH as H, "PATCH"],
  ["GET /admin/export", adminExport.GET as H, "GET"],
  ["GET /admin/metrics", adminMetrics.GET as H, "GET"],
  ["GET /admin/users", adminUsers.GET as H, "GET"],
  ["PATCH /admin/walkers/[id]", adminWalker.PATCH as H, "PATCH", P],
  ["GET /admin/walkers", adminWalkers.GET as H, "GET"],
  ["GET /bookings/[id]", booking.GET as H, "GET", P],
  ["PATCH /bookings/[id]", booking.PATCH as H, "PATCH", P],
  ["GET /bookings", bookings.GET as H, "GET"],
  ["POST /bookings", bookings.POST as H, "POST"],
  ["PATCH /disputes/[id]", dispute.PATCH as H, "PATCH", P],
  ["GET /disputes", disputes.GET as H, "GET"],
  ["POST /disputes", disputes.POST as H, "POST"],
  ["PATCH /dogs/[id]", dog.PATCH as H, "PATCH", P],
  ["DELETE /dogs/[id]", dog.DELETE as H, "DELETE", P],
  ["GET /dogs", dogs.GET as H, "GET"],
  ["POST /dogs", dogs.POST as H, "POST"],
  ["GET /messages", messages.GET as H, "GET"],
  ["POST /messages", messages.POST as H, "POST"],
  ["GET /notifications", notifications.GET as H, "GET"],
  ["PATCH /notifications", notifications.PATCH as H, "PATCH"],
  ["POST /payments/[id]/confirm", paymentConfirm.POST as H, "POST", P],
  ["GET /payments", payments.GET as H, "GET"],
  ["POST /payments", payments.POST as H, "POST"],
  ["PATCH /payouts/[id]", payout.PATCH as H, "PATCH", P],
  ["GET /payouts", payouts.GET as H, "GET"],
  ["POST /payouts", payouts.POST as H, "POST"],
  ["POST /realtime/token", realtimeToken.POST as H, "POST"],
  ["POST /reviews", reviews.POST as H, "POST"],
  ["GET /users/me", me.GET as H, "GET"],
  ["PATCH /users/me", me.PATCH as H, "PATCH"],
  ["POST /walkers/match", walkerMatch.POST as H, "POST"],
  ["GET /walks/[id]", walk.GET as H, "GET", P],
  ["PATCH /walks/[id]", walk.PATCH as H, "PATCH", P],
  ["POST /walks/[id]/track", walkTrack.POST as H, "POST", P],
  ["GET /walks", walks.GET as H, "GET"],
  ["GET /wallet", wallet.GET as H, "GET"],
];

describe("anonymous callers get 401 everywhere", () => {
  for (const [name, handler, method, params] of PROTECTED) {
    test(name, async () => {
      const r = await call(handler, { method, params, body: method === "GET" ? undefined : {} });
      expect(r.status).toBe(401);
    });
  }
});

const cookies: Record<string, string> = {};
let anaBookingId: string;
let anaWalkId: string;
let anaHeldPaymentId: string;
let anaDogId: string;
let requestedPayoutId: string;
let openDisputeId: string;
let pendingWalkerProfileId: string;

beforeAll(async () => {
  for (const [k, phone] of Object.entries(PHONES)) cookies[k] = await cookieFor(phone);
  const ana = await userId(PHONES.ana);
  anaBookingId = (await db.booking.findFirstOrThrow({ where: { ownerId: ana, status: "CONFIRMED" } })).id;
  anaWalkId = (await db.walk.findFirstOrThrow({ where: { ownerId: ana, status: "IN_PROGRESS" } })).id;
  anaHeldPaymentId = (await db.payment.findFirstOrThrow({ where: { ownerId: ana, status: "HELD" } })).id;
  anaDogId = (await db.dog.findFirstOrThrow({ where: { ownerId: ana } })).id;
  requestedPayoutId = (await db.payout.findFirstOrThrow({ where: { status: "REQUESTED" } })).id;
  openDisputeId = (await db.dispute.findFirstOrThrow({ where: { status: "OPEN" } })).id;
  pendingWalkerProfileId = (
    await db.walkerProfile.findFirstOrThrow({ where: { status: "PENDING" } })
  ).id;
});

describe("admin routes reject owners and walkers", () => {
  const ADMIN_ONLY: [string, H, string, () => Record<string, string>][] = [
    ["GET /admin/bookings", adminBookings.GET as H, "GET", () => ({})],
    ["PATCH /admin/config", adminConfig.PATCH as H, "PATCH", () => ({})],
    ["GET /admin/export", adminExport.GET as H, "GET", () => ({})],
    ["GET /admin/metrics", adminMetrics.GET as H, "GET", () => ({})],
    ["GET /admin/users", adminUsers.GET as H, "GET", () => ({})],
    ["GET /admin/walkers", adminWalkers.GET as H, "GET", () => ({})],
    ["PATCH /admin/walkers/[id]", adminWalker.PATCH as H, "PATCH", () => ({ id: pendingWalkerProfileId })],
    ["PATCH /disputes/[id]", dispute.PATCH as H, "PATCH", () => ({ id: openDisputeId })],
    ["PATCH /payouts/[id]", payout.PATCH as H, "PATCH", () => ({ id: requestedPayoutId })],
  ];
  for (const who of ["ana", "luis"] as const) {
    for (const [name, handler, method, params] of ADMIN_ONLY) {
      test(`${who}: ${name} → 403`, async () => {
        const body = method === "GET" ? undefined : { action: "APPROVE", status: "PAID" };
        const r = await call(handler, { method, params: params(), cookie: cookies[who], body });
        expect(r.status).toBe(403);
      });
    }
  }

  test("admin can read admin routes", async () => {
    expect((await call(adminUsers.GET as H, { cookie: cookies.admin })).status).toBe(200);
  });
});

describe("owners cannot touch another owner's data", () => {
  test("GET someone else's booking → 403", async () => {
    const r = await call(booking.GET as H, { params: { id: anaBookingId }, cookie: cookies.carlos });
    expect(r.status).toBe(403);
  });

  test("cancel someone else's booking → 403", async () => {
    const r = await call(booking.PATCH as H, {
      method: "PATCH",
      params: { id: anaBookingId },
      cookie: cookies.carlos,
      body: { action: "cancel", reason: "x" },
    });
    expect(r.status).toBe(403);
  });

  test("GET someone else's walk → 403", async () => {
    const r = await call(walk.GET as H, { params: { id: anaWalkId }, cookie: cookies.carlos });
    expect(r.status).toBe(403);
  });

  test("read someone else's chat thread → 403", async () => {
    const r = await call(messages.GET as H, {
      path: `/api/messages?threadId=${anaBookingId}`,
      cookie: cookies.carlos,
    });
    expect(r.status).toBe(403);
  });

  test("post into someone else's chat thread → 403", async () => {
    const r = await call(messages.POST as H, {
      method: "POST",
      cookie: cookies.carlos,
      body: { threadId: anaBookingId, body: "hola" },
    });
    expect(r.status).toBe(403);
  });

  test("edit / delete someone else's dog → 403", async () => {
    const edit = await call(dog.PATCH as H, {
      method: "PATCH",
      params: { id: anaDogId },
      cookie: cookies.carlos,
      body: { name: "Hacked" },
    });
    expect(edit.status).toBe(403);
    const del = await call(dog.DELETE as H, { method: "DELETE", params: { id: anaDogId }, cookie: cookies.carlos });
    expect(del.status).toBe(403);
    expect((await db.dog.findUnique({ where: { id: anaDogId } }))?.name).not.toBe("Hacked");
  });

  test("book with someone else's dog → 403", async () => {
    const r = await call(bookings.POST as H, {
      method: "POST",
      cookie: cookies.carlos,
      body: { dogId: anaDogId, type: "ONE_OFF", schedule: [], durationMin: 30 },
    });
    expect(r.status).toBe(403);
  });

  test("confirm someone else's payment → 403", async () => {
    const r = await call(paymentConfirm.POST as H, {
      method: "POST",
      params: { id: anaHeldPaymentId },
      cookie: cookies.carlos,
      body: {},
    });
    expect(r.status).toBe(403);
  });

  test("lists are scoped to the caller", async () => {
    const carlos = await userId(PHONES.carlos);
    const owned = async (model: "booking" | "payment", ids: string[]) =>
      (await (db[model] as any).count({ where: { id: { in: ids }, ownerId: carlos } })) === ids.length;
    const bs = await call(bookings.GET as H, { cookie: cookies.carlos });
    expect(bs.json.length).toBeGreaterThan(0);
    expect(await owned("booking", bs.json.map((b: { id: string }) => b.id))).toBe(true);
    const ps = await call(payments.GET as H, { cookie: cookies.carlos });
    expect(await owned("payment", ps.json.map((p: { id: string }) => p.id))).toBe(true);
    const ds = await call(dogs.GET as H, { path: `/api/dogs?ownerId=${await userId(PHONES.ana)}`, cookie: cookies.carlos });
    expect(ds.json.every((d: { ownerId: string }) => d.ownerId === carlos)).toBe(true);
  });

  test("owners have no wallet and cannot request payouts", async () => {
    expect((await call(wallet.GET as H, { cookie: cookies.ana })).status).toBe(403);
    const r = await call(payouts.POST as H, { method: "POST", cookie: cookies.ana, body: { amountCents: 2000 } });
    expect(r.status).toBe(403);
  });
});

describe("walkers only see what they were booked for", () => {
  test("unrelated walker cannot list an owner's dogs", async () => {
    const r = await call(dogs.GET as H, {
      path: `/api/dogs?ownerId=${await userId(PHONES.ana)}`,
      cookie: cookies.gabriela,
    });
    expect(r.status).toBe(403);
  });

  test("assigned walker can list that owner's dogs", async () => {
    const r = await call(dogs.GET as H, {
      path: `/api/dogs?ownerId=${await userId(PHONES.ana)}`,
      cookie: cookies.luis,
    });
    expect(r.status).toBe(200);
    expect(r.json.length).toBeGreaterThan(0);
  });

  test("unrelated walker cannot read the booking or the walk", async () => {
    expect((await call(booking.GET as H, { params: { id: anaBookingId }, cookie: cookies.gabriela })).status).toBe(403);
    expect((await call(walk.GET as H, { params: { id: anaWalkId }, cookie: cookies.gabriela })).status).toBe(403);
  });

  test("unrelated walker cannot push GPS points or update the walk", async () => {
    const track = await call(walkTrack.POST as H, {
      method: "POST",
      params: { id: anaWalkId },
      cookie: cookies.gabriela,
      body: { points: [{ lat: -17.78, lng: -63.18 }] },
    });
    expect(track.status).toBe(403);
    const upd = await call(walk.PATCH as H, {
      method: "PATCH",
      params: { id: anaWalkId },
      cookie: cookies.gabriela,
      body: { action: "END" },
    });
    expect(upd.status).toBe(403);
  });

  test("walkers cannot create bookings, dogs or reviews", async () => {
    expect((await call(bookings.POST as H, { method: "POST", cookie: cookies.luis, body: {} })).status).toBe(403);
    expect((await call(dogs.POST as H, { method: "POST", cookie: cookies.luis, body: {} })).status).toBe(403);
    expect((await call(reviews.POST as H, { method: "POST", cookie: cookies.luis, body: {} })).status).toBe(403);
  });
});

describe("public data does not leak private fields", () => {
  test("walker profile has no phone number", async () => {
    const luis = await userId(PHONES.luis);
    const r = await call(walkerDetail.GET as H, { params: { id: luis } });
    expect(r.status).toBe(200);
    expect(r.json.phone).toBeUndefined();
    expect(JSON.stringify(r.json)).not.toContain(PHONES.luis);
  });
});
