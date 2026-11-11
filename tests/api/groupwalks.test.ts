/// <reference types="bun-types" />
// Phase 3: group walks — a walker offers a slot, owners join with one dog
// each (ordinary bookings at the group price), the walker picks each dog up,
// GPS fixes fan out to every dog on the walk, each drop-off settles with the
// walker keeping walkerPerDogCents. The ledger must balance throughout.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as slotsRoute from "@/app/api/group-slots/route";
import * as slotRoute from "@/app/api/group-slots/[id]/route";
import * as joinRoute from "@/app/api/group-slots/[id]/join/route";
import * as bookingRoute from "@/app/api/bookings/[id]/route";
import * as walkRoute from "@/app/api/walks/[id]/route";
import * as trackRoute from "@/app/api/walks/[id]/track/route";
import * as mockPayRoute from "@/app/api/payments/mock/pay/route";
import * as configRoute from "@/app/api/admin/config/route";
import { getAppConfig, updateConfigSection } from "@/lib/server/config";
import { accountBalance, walletBalance } from "@/lib/server/ledger";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { groupCommissionPct } from "@/lib/server/groupWalks";
import { walkSplit } from "@/lib/server/payments/settle";
import { call, cookieFor, PHONES, userId } from "./helpers";
import { dayAhead, expectLedgerBalanced, type H } from "./flows";

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const PRICE = 1800;
const WALKER = 1400;

async function dogOf(phone: string, name: string) {
  const owner = await db.user.findUniqueOrThrow({ where: { phone }, include: { dogs: true } });
  return owner.dogs.find((d) => d.name === name)!.id;
}

async function openSlot(body: Record<string, unknown>, who = "luis") {
  return call(slotsRoute.POST as H, {
    method: "POST",
    cookie: cookies[who],
    body: { date: dayAhead(2), minute: 420, capacity: 3, ...body },
  });
}

async function join(slotId: string, who: string, dogId: string, paymentMethod = "QR") {
  return call(joinRoute.POST as H, {
    method: "POST",
    cookie: cookies[who],
    params: { id: slotId },
    body: { dogId, paymentMethod },
  });
}

/** Walker action on a walk at the owner's door. */
async function act(walkId: string, action: "start" | "finish") {
  const walk = await db.walk.findUniqueOrThrow({ where: { id: walkId }, include: { owner: true } });
  return call(walkRoute.PATCH as H, {
    method: "PATCH",
    params: { id: walkId },
    cookie: cookies.luis,
    body: {
      action,
      lat: walk.owner.addressLat,
      lng: walk.owner.addressLng,
      acc: 5,
      ...(action === "finish" ? { report: { note: "Grupo feliz", pee: true } } : {}),
    },
  });
}

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  for (const k of ["admin", "ana", "carlos", "sofia", "luis", "jose"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
  await updateConfigSection("groupWalks", {
    enabled: 1,
    durationMin: 45,
    maxDogs: 3,
    pricePerDogCents: PRICE,
    walkerPerDogCents: WALKER,
    joinCloseMinutes: 120,
  });
  await updateConfigSection("fees", { ownerFeePct: 0 });
});

afterAll(async () => {
  setRealtimePublisherForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

describe("pricing", () => {
  test("the group commission leaves the walker exactly their share", () => {
    const pct = groupCommissionPct({ pricePerDogCents: PRICE, walkerPerDogCents: WALKER });
    const split = walkSplit({ amountCents: PRICE, ownerFeeCents: 0, refundedCents: 0 }, pct);
    expect(split.netCents).toBe(WALKER);
    expect(split.platformCents).toBe(PRICE - WALKER);
  });

  test("config validates the walker share and size of a group", async () => {
    const tooMuch = await call(configRoute.PATCH as H, {
      method: "PATCH",
      cookie: cookies.admin,
      body: { section: "groupWalks", patch: { walkerPerDogCents: PRICE + 1 } },
    });
    expect(tooMuch.status).toBe(400);
    const tooBig = await call(configRoute.PATCH as H, {
      method: "PATCH",
      cookie: cookies.admin,
      body: { section: "groupWalks", patch: { maxDogs: 6 } },
    });
    expect(tooBig.status).toBe(400);
  });
});

describe("walker opens a group slot", () => {
  test("only active, trial-complete walkers; owners cannot", async () => {
    expect((await openSlot({}, "ana")).status).toBe(403);
    expect((await openSlot({}, "jose")).status).toBe(403); // pending walker
  });

  test("capacity, notice and overlap are checked", async () => {
    expect((await openSlot({ capacity: 4 })).status).toBe(400);
    expect((await openSlot({ capacity: 1 })).status).toBe(400);
    expect((await openSlot({ date: dayAhead(0), minute: 0 })).status).toBe(400); // in the past / too soon
    expect((await openSlot({ date: dayAhead(30) })).status).toBe(400);
  });

  test("a slot gets the group price; the walker sees their share", async () => {
    const r = await openSlot({ note: "Parque Urbano" });
    expect(r.status).toBe(201);
    expect(r.json.pricePerDogCents).toBe(PRICE);
    expect(r.json.walkerPerDogCents).toBe(WALKER);
    expect(r.json.durationMin).toBe(45);
    expect(r.json.spotsLeft).toBe(3);
    expect(r.json.joinable).toBe(true);
    ids.slot = r.json.id;
    expect((await openSlot({ minute: 440 })).status).toBe(400); // overlaps
  });

  test("owners in the zone see it without the walker's share", async () => {
    const r = await call(slotsRoute.GET as H, { cookie: cookies.ana });
    const slot = r.json.find((s: { id: string }) => s.id === ids.slot);
    expect(slot).toBeTruthy();
    expect(slot.walkerPerDogCents).toBeNull();
    expect(slot.dogs).toEqual([]);
    expect(slot.walker.name).toBe("Luis Quisbert");
  });
});

describe("owners join", () => {
  test("one dog → a CONFIRMED booking with a walk and a payment at the group price", async () => {
    const r = await join(ids.slot, "ana", await dogOf(PHONES.ana, "Max"));
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("CONFIRMED");
    expect(r.json.groupSlotId).toBe(ids.slot);
    expect(r.json.payment.amountCents).toBe(PRICE);
    expect(r.json.payment.status).toBe("PENDING");
    ids.anaBooking = r.json.id;
    const walk = await db.walk.findFirstOrThrow({ where: { bookingId: r.json.id } });
    expect(walk.groupSlotId).toBe(ids.slot);
    expect(walk.durationMin).toBe(45);
    expect(walk.walkerId).toBe(ids.luis);
  });

  test("the same dog cannot join twice; anxious dogs walk alone", async () => {
    expect((await join(ids.slot, "ana", await dogOf(PHONES.ana, "Max"))).status).toBe(400);
    const rocky = await join(ids.slot, "sofia", await dogOf(PHONES.sofia, "Rocky"));
    expect(rocky.status).toBe(400);
    expect(rocky.json.error).toContain("solos");
  });

  test("another owner joins (cash); the walker sees both dogs", async () => {
    const r = await join(ids.slot, "carlos", await dogOf(PHONES.carlos, "Luna"), "CASH");
    expect(r.status).toBe(201);
    ids.carlosBooking = r.json.id;
    const mine = await call(slotsRoute.GET as H, { cookie: cookies.luis });
    const slot = mine.json.find((s: { id: string }) => s.id === ids.slot);
    expect(slot.taken).toBe(2);
    expect(slot.dogs.map((d: { dogName: string }) => d.dogName).sort()).toEqual(["Luna", "Max"]);
  });

  test("a group booking cannot be rescheduled", async () => {
    const r = await call(bookingRoute.PATCH as H, {
      method: "PATCH",
      params: { id: ids.anaBooking },
      cookie: cookies.ana,
      body: { action: "reschedule", schedule: [{ date: dayAhead(3), minute: 600 }] },
    });
    expect(r.status).toBe(400);
  });

  test("sizes and capacity are enforced; leaving frees the spot", async () => {
    const small = await openSlot({ date: dayAhead(3), capacity: 2, sizes: ["S"] });
    expect(small.status).toBe(201);
    const sid = small.json.id;
    expect((await join(sid, "carlos", await dogOf(PHONES.carlos, "Zeus"))).status).toBe(400); // M dog
    expect((await join(sid, "ana", await dogOf(PHONES.ana, "Coco"))).status).toBe(201);
    const nala = await join(sid, "sofia", await dogOf(PHONES.sofia, "Nala"));
    expect(nala.status).toBe(201);
    const extra = await db.dog.create({
      data: { ownerId: ids.carlos, name: "Mini", breed: "Chihuahua", size: "S", ageYears: 1, temperament: "CALM" },
    });
    expect((await join(sid, "carlos", extra.id)).status).toBe(400); // full
    // Sofía leaves (well in advance: full refund path) → the spot is free again.
    const leave = await call(bookingRoute.PATCH as H, {
      method: "PATCH",
      params: { id: nala.json.id },
      cookie: cookies.sofia,
      body: { action: "cancel" },
    });
    expect(leave.status).toBe(200);
    expect((await join(sid, "carlos", extra.id)).status).toBe(201);
    ids.smallSlot = sid;
  });

  test("joining closes before the start", async () => {
    await db.groupSlot.update({ where: { id: ids.smallSlot }, data: { startsAt: new Date(Date.now() + 60 * 60_000) } });
    const late = await db.dog.create({
      data: { ownerId: ids.ana, name: "Pulga", breed: "Pinscher", size: "S", ageYears: 1, temperament: "CALM" },
    });
    // Capacity 2 is full anyway; widen it to see the cut-off message.
    await db.groupSlot.update({ where: { id: ids.smallSlot }, data: { capacity: 3 } });
    const r = await join(ids.smallSlot, "ana", late.id);
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("cerraron");
  });
});

describe("the group walk", () => {
  test("pick up each dog, one route for all, each drop-off settles at the group split", async () => {
    // Ana pays her QR; Carlos pays cash to the walker.
    const anaPayment = await db.payment.findFirstOrThrow({ where: { bookingId: ids.anaBooking } });
    expect((await call(mockPayRoute.POST as H, { method: "POST", cookie: cookies.ana, body: { paymentId: anaPayment.id } })).json.status).toBe(
      "HELD"
    );
    const walks = await db.walk.findMany({ where: { groupSlotId: ids.slot } });
    const anaWalk = walks.find((w) => w.bookingId === ids.anaBooking)!;
    const carlosWalk = walks.find((w) => w.bookingId === ids.carlosBooking)!;
    await db.walk.updateMany({ where: { groupSlotId: ids.slot }, data: { scheduledStart: new Date() } });

    expect((await act(anaWalk.id, "start")).status).toBe(200);
    expect((await act(carlosWalk.id, "start")).status).toBe(200);
    // Back-date the pick-ups so fixes from the last minutes are valid for both.
    const t0 = Date.now() - 10 * 60_000;
    await db.walk.update({ where: { id: anaWalk.id }, data: { startedAt: new Date(t0) } });
    await db.walk.update({ where: { id: carlosWalk.id }, data: { startedAt: new Date(t0 + 60_000) } });

    // The walker's detail lists the other dog for the tracker hand-off.
    const detail = await call(walkRoute.GET as H, { cookie: cookies.luis, params: { id: anaWalk.id } });
    expect(detail.json.group).toHaveLength(1);
    expect(detail.json.group[0].id).toBe(carlosWalk.id);
    expect(detail.json.group[0].status).toBe("IN_PROGRESS");
    const ownerView = await call(walkRoute.GET as H, { cookie: cookies.ana, params: { id: anaWalk.id } });
    expect(ownerView.json.group).toEqual([]);

    // The phone tracks Ana's walk; fixes after Carlos's pick-up reach his walk too.
    const ana = await db.user.findUniqueOrThrow({ where: { id: anaWalk.ownerId } });
    const points = Array.from({ length: 8 }, (_, i) => ({
      seq: i,
      lat: ana.addressLat! + i * 0.0002,
      lng: ana.addressLng!,
      ts: t0 + 30_000 + i * 30_000,
      acc: 5,
    }));
    const up = await call(trackRoute.POST as H, {
      method: "POST",
      params: { id: anaWalk.id },
      cookie: cookies.luis,
      body: { points },
    });
    expect(up.status).toBe(200);
    expect(up.json.accepted).toBe(8);
    const anaPts = await db.walkTrackPoint.count({ where: { walkId: anaWalk.id, rejectReason: null } });
    const carlosPts = await db.walkTrackPoint.findMany({ where: { walkId: carlosWalk.id }, orderBy: { seq: "asc" } });
    expect(anaPts).toBe(8);
    // Only fixes from Carlos's pick-up on (ts ≥ t0 + 60 s): seq 1..7.
    expect(carlosPts.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((await db.walk.findUniqueOrThrow({ where: { id: carlosWalk.id } })).distanceMeters).toBeGreaterThan(0);
    // Re-sending the batch is idempotent for every dog.
    await call(trackRoute.POST as H, { method: "POST", params: { id: anaWalk.id }, cookie: cookies.luis, body: { points } });
    expect(await db.walkTrackPoint.count({ where: { walkId: carlosWalk.id } })).toBe(7);

    // Drop-offs: each dog's own report and settlement at the group split.
    const walletBefore = await walletBalance(ids.luis);
    const revenueBefore = await accountBalance("platform:revenue");
    expect((await act(anaWalk.id, "finish")).status).toBe(200);
    expect(await walletBalance(ids.luis)).toBe(walletBefore + WALKER);
    expect(await accountBalance("platform:revenue")).toBe(revenueBefore + PRICE - WALKER);

    // After Ana's drop-off the phone tracks Carlos's walk directly.
    const more = await call(trackRoute.POST as H, {
      method: "POST",
      params: { id: carlosWalk.id },
      cookie: cookies.luis,
      body: { points: [{ seq: 8, lat: ana.addressLat! + 0.0018, lng: ana.addressLng!, ts: t0 + 300_000, acc: 5 }] },
    });
    expect(more.json.accepted).toBe(1);

    expect((await act(carlosWalk.id, "finish")).status).toBe(200);
    // Cash: the walker collected Bs 18 and owes FiruWalk its Bs 4.
    expect(await walletBalance(ids.luis)).toBe(walletBefore + WALKER - (PRICE - WALKER));
    expect(await db.reportCard.count({ where: { walkId: { in: [anaWalk.id, carlosWalk.id] } } })).toBe(2);
    expect((await db.booking.findUniqueOrThrow({ where: { id: ids.anaBooking } })).status).toBe("COMPLETED");
    await expectLedgerBalanced();
  });
});

describe("walker cancels the whole group", () => {
  test("everyone is refunded in full and told; the slot closes", async () => {
    const r = await openSlot({ date: dayAhead(4), minute: 1080 });
    expect(r.status).toBe(201);
    const sid = r.json.id;
    const joined = await join(sid, "ana", await dogOf(PHONES.ana, "Max"));
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId: joined.json.id } });
    await call(mockPayRoute.POST as H, { method: "POST", cookie: cookies.ana, body: { paymentId: payment.id } });
    const strikesBefore = (await db.walkerProfile.findUniqueOrThrow({ where: { userId: ids.luis } })).strikes;

    expect((await call(slotRoute.PATCH as H, { method: "PATCH", params: { id: sid }, cookie: cookies.carlos, body: { action: "cancel" } })).status).toBe(403);
    const c = await call(slotRoute.PATCH as H, {
      method: "PATCH",
      params: { id: sid },
      cookie: cookies.luis,
      body: { action: "cancel", reason: "Lluvia fuerte" },
    });
    expect(c.status).toBe(200);
    expect((await db.groupSlot.findUniqueOrThrow({ where: { id: sid } })).status).toBe("CANCELLED");
    const b = await db.booking.findUniqueOrThrow({ where: { id: joined.json.id }, include: { walks: true } });
    expect(b.status).toBe("CANCELLED");
    expect(b.walks.every((w) => w.status === "CANCELLED")).toBe(true);
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REFUNDED");
    expect(p.refundedCents).toBe(PRICE);
    // Four days ahead: not a late cancellation → no strike.
    expect((await db.walkerProfile.findUniqueOrThrow({ where: { userId: ids.luis } })).strikes).toBe(strikesBefore);
    const note = await db.notification.findFirst({ where: { userId: ids.ana, title: { contains: "grupal" } } });
    expect(note?.body).toContain("Lluvia fuerte");
    // Cancelled slots are not offered any more.
    const list = await call(slotsRoute.GET as H, { cookie: cookies.carlos, path: `/api/group-slots?zoneId=${r.json.zone.id}` });
    expect(list.json.some((s: { id: string }) => s.id === sid)).toBe(false);
    expect((await call(slotRoute.PATCH as H, { method: "PATCH", params: { id: sid }, cookie: cookies.luis, body: { action: "cancel" } })).status).toBe(400);
    await expectLedgerBalanced();
  });

  test("with group walks off nobody can open or join", async () => {
    await updateConfigSection("groupWalks", { enabled: 0 });
    try {
      expect((await openSlot({ date: dayAhead(5) })).status).toBe(400);
    } finally {
      await updateConfigSection("groupWalks", { enabled: 1 });
    }
    expect((await getAppConfig()).groupWalks.enabled).toBe(1);
  });
});
