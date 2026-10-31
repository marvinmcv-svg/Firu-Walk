/// <reference types="bun-types" />
// Milestone 4 — real GPS tracking: point validation rules, idempotent batch
// uploads, server-side distance, the start/end geofence and admin overrides.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as walkRoute from "@/app/api/walks/[id]/route";
import * as trackRoute from "@/app/api/walks/[id]/track/route";
import * as overrideRoute from "@/app/api/admin/walks/[id]/override/route";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { DEFAULT_CONFIG } from "@/lib/server/config";
import { haversineMeters, validateTrackBatch, type Fix, type TrackState } from "@/lib/server/tracking";
import { call, cookieFor, PHONES, userId } from "./helpers";

type H = Parameters<typeof call>[0];
const rules = DEFAULT_CONFIG.tracking;

// Ana's home (seed) and helpers to move around it.
const HOME = { lat: -17.7931, lng: -63.1998 };
const M_PER_DEG = 111_320;
const north = (m: number, from = HOME) => ({ lat: from.lat + m / M_PER_DEG, lng: from.lng });

/* ------------------------------------------------------------ unit rules */

describe("validateTrackBatch", () => {
  const t0 = 1_800_000_000_000;
  const start: TrackState = { anchor: { seq: -1, ...HOME, ts: t0 }, streak: [], maxSeq: -1 };
  const win = { startedAt: t0, now: t0 + 3_600_000 };
  const fix = (seq: number, metersNorth: number, sec: number, extra: Partial<Fix> = {}): Fix => ({
    seq,
    ...north(metersNorth),
    ts: t0 + sec * 1_000,
    acc: 5,
    ...extra,
  });

  test("walking pace is accepted and distance adds up between accepted fixes", () => {
    const { results, state } = validateTrackBatch(start, [fix(0, 10, 10), fix(1, 25, 20), fix(2, 40, 30)], rules, win);
    expect(results.map((r) => r.rejectReason)).toEqual([null, null, null]);
    // first fix is measured from the start position but not counted
    const total = results.reduce((s, r) => s + r.addMeters, 0);
    expect(Math.round(total)).toBe(30);
    expect(state.maxSeq).toBe(2);
    expect(state.anchor?.seq).toBe(2);
  });

  test("speed above the limit, teleports and mock fixes are rejected", () => {
    const { results } = validateTrackBatch(
      start,
      [
        fix(0, 10, 10),
        fix(1, 200, 20), // 190 m in 10 s ≈ 68 km/h
        fix(2, 5_000, 600), // 5 km jump
        fix(3, 20, 40, { mock: true }),
        fix(4, 25, 50, { acc: 500 }),
        fix(5, 30, 60),
      ],
      rules,
      win
    );
    expect(results.map((r) => r.rejectReason)).toEqual([
      null,
      "too_fast",
      "teleport",
      "mock_location",
      "inaccurate",
      null,
    ]);
    expect(Math.round(results.reduce((s, r) => s + r.addMeters, 0))).toBe(20);
  });

  test("timestamps must move forward and stay inside the walk window", () => {
    const { results } = validateTrackBatch(
      start,
      [fix(0, 10, 30), fix(1, 15, 20), fix(2, 20, 3 * 3_600), fix(3, 20, -3_600)],
      rules,
      win
    );
    expect(results.map((r) => r.rejectReason)).toEqual([null, "out_of_order", "bad_timestamp", "bad_timestamp"]);
  });

  test("a seq at or below the stored maximum is out of order", () => {
    const state: TrackState = { ...start, maxSeq: 10 };
    const { results } = validateTrackBatch(state, [fix(4, 10, 10), fix(11, 20, 20)], rules, win);
    expect(results.map((r) => r.rejectReason)).toEqual(["out_of_order", null]);
  });

  test("sustained, self-consistent movement re-anchors without counting the jump", () => {
    // Anchor is wrong (a bad fix accepted earlier); the real walker is 2 km away.
    const far = north(2_000);
    const anchored: TrackState = { anchor: { seq: 0, ...HOME, ts: t0 }, streak: [], maxSeq: 0 };
    const at = (seq: number, m: number, sec: number): Fix => ({ seq, ...north(m, far), ts: t0 + sec * 1_000, acc: 5 });
    const { results, state } = validateTrackBatch(
      anchored,
      [at(1, 0, 10), at(2, 10, 20), at(3, 20, 30), at(4, 30, 40)],
      rules,
      win
    );
    expect(results.map((r) => r.rejectReason)).toEqual(["teleport", "teleport", null, null]);
    expect(results[2].addMeters).toBe(0);
    expect(Math.round(results[3].addMeters)).toBe(10);
    expect(state.anchor?.seq).toBe(4);
  });
});

/* ------------------------------------------------------------- routes */

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const published: { room: string; event: string; data: Record<string, unknown> }[] = [];
let template: { bookingId: string; walkerId: string; ownerId: string; dogId: string; zoneId: string };
let walkerKey: keyof typeof PHONES;
const created: string[] = [];

async function newWalk(status: "SCHEDULED" | "IN_PROGRESS" = "SCHEDULED") {
  const w = await db.walk.create({
    data: {
      ...template,
      status,
      scheduledStart: new Date(),
      ...(status === "IN_PROGRESS"
        ? { startedAt: new Date(Date.now() - 10 * 60_000), startLat: HOME.lat, startLng: HOME.lng }
        : {}),
    },
  });
  created.push(w.id);
  return w.id;
}

const patch = (id: string, who: keyof typeof PHONES, body: Record<string, unknown>) =>
  call(walkRoute.PATCH as H, { method: "PATCH", params: { id }, cookie: cookies[who], body });
const upload = (id: string, who: keyof typeof PHONES, points: unknown[]) =>
  call(trackRoute.POST as H, { method: "POST", params: { id }, cookie: cookies[who], body: { points } });
const report = { note: "ok", pee: true, poo: false, water: true, photos: [] };

/** n fixes walking north from home, one every 10 s ending ~now. */
function walkFixes(fromSeq: number, n: number, stepM = 12) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    seq: fromSeq + i,
    ...north((fromSeq + i + 1) * stepM),
    ts: now - (n - i) * 10_000,
    acc: 6,
  }));
}

beforeAll(async () => {
  for (const [k, phone] of Object.entries(PHONES)) {
    cookies[k] = await cookieFor(phone);
    ids[k] = await userId(phone);
  }
  const live = await db.walk.findFirstOrThrow({ where: { ownerId: ids.ana, status: "IN_PROGRESS" } });
  // A booking of our own (no payment), so finishing walks here does not
  // settle the seeded payments other suites rely on.
  const b = await db.booking.findUniqueOrThrow({ where: { id: live.bookingId } });
  const own = await db.booking.create({
    data: {
      ownerId: b.ownerId,
      dogId: b.dogId,
      walkerId: b.walkerId,
      zoneId: b.zoneId,
      type: "ONE_OFF",
      status: "CONFIRMED",
      scheduleJson: "[]",
      pricePerWalkCents: b.pricePerWalkCents,
    },
  });
  template = {
    bookingId: own.id,
    walkerId: live.walkerId,
    ownerId: live.ownerId,
    dogId: live.dogId,
    zoneId: live.zoneId,
  };
  walkerKey = (Object.keys(ids) as (keyof typeof PHONES)[]).find((k) => ids[k] === live.walkerId)!;
  setRealtimePublisherForTests(async (room, event, data) => {
    published.push({ room, event, data });
  });
});

afterAll(async () => {
  setRealtimePublisherForTests(null);
  await db.walk.updateMany({ where: { id: { in: created } }, data: { status: "CANCELLED" } });
});

describe("start / finish geofence", () => {
  test("start needs a real position within the geofence of the owner's address", async () => {
    const id = await newWalk();
    expect((await patch(id, walkerKey, { action: "start" })).status).toBe(400);
    const far = await patch(id, walkerKey, { action: "start", ...north(600), acc: 10 });
    expect(far.status).toBe(400);
    expect(far.json.error).toContain("demasiado lejos");
    expect((await patch(id, walkerKey, { action: "start", ...north(20), mock: true })).status).toBe(400);
    expect((await patch(id, walkerKey, { action: "start", lat: 999, lng: 0 })).status).toBe(400);

    const ok = await patch(id, walkerKey, { action: "start", ...north(60), acc: 8 });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe("IN_PROGRESS");
    expect(ok.json.pickup).toMatchObject(HOME);
    const w = await db.walk.findUniqueOrThrow({ where: { id } });
    expect(Math.abs((w.startDistanceM ?? 0) - 60)).toBeLessThan(2);
    // a second start cannot restart it
    expect((await patch(id, walkerKey, { action: "start", ...north(10) })).status).toBe(400);
  });

  test("the owner cannot start the walk", async () => {
    const id = await newWalk();
    expect((await patch(id, "ana", { action: "start", ...north(5) })).status).toBe(403);
  });

  test("finish ignores the client's track and distance and needs the geofence", async () => {
    const id = await newWalk("IN_PROGRESS");
    expect((await upload(id, walkerKey, walkFixes(0, 5))).status).toBe(200);
    const before = await db.walk.findUniqueOrThrow({ where: { id } });

    const far = await patch(id, walkerKey, { action: "finish", report, ...north(900) });
    expect(far.status).toBe(400);

    const r = await patch(id, walkerKey, {
      action: "finish",
      report,
      ...north(30),
      track: [[0, 0], [1, 1]],
      distanceMeters: 99_999,
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("COMPLETED");
    expect(r.json.distanceMeters).toBe(Math.round(before.distanceMeters));
    expect(r.json.track).toHaveLength(5);
    expect(published.some((p) => p.room === `walk:${id}` && p.event === "walk:ended")).toBe(true);
  });
});

describe("POST /api/walks/[id]/track", () => {
  test("only the assigned walker may upload, only while in progress", async () => {
    const id = await newWalk("IN_PROGRESS");
    expect((await upload(id, "ana", walkFixes(0, 1))).status).toBe(403);
    expect((await upload(id, "gabriela", walkFixes(0, 1))).status).toBe(403);
    expect((await upload(id, "admin", walkFixes(0, 1))).status).toBe(403);
    const scheduled = await newWalk();
    expect((await upload(scheduled, walkerKey, walkFixes(0, 1))).status).toBe(409);
  });

  test("malformed batches are refused", async () => {
    const id = await newWalk("IN_PROGRESS");
    expect((await upload(id, walkerKey, [])).status).toBe(400);
    expect((await upload(id, walkerKey, [{ lat: 1, lng: 2 }])).status).toBe(400);
    expect((await upload(id, walkerKey, [{ seq: 0, lat: 91, lng: 0, ts: Date.now() }])).status).toBe(400);
    expect((await upload(id, walkerKey, walkFixes(0, 201))).status).toBe(400);
  });

  test("uploads are idempotent by seq and distance is computed server-side", async () => {
    const id = await newWalk("IN_PROGRESS");
    published.length = 0;
    const batch = walkFixes(0, 6);
    const first = await upload(id, walkerKey, batch);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ accepted: 6, rejected: [], duplicates: 0, lastSeq: 5 });
    // 5 segments of 12 m (the first fix is measured from the start point)
    expect(first.json.distanceMeters).toBe(60);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ room: `walk:${id}`, event: "walk:points", data: { distMeters: 60 } });

    // retry of the same batch (e.g. the response was lost) → no double count
    const retry = await upload(id, walkerKey, batch);
    expect(retry.json).toMatchObject({ accepted: 0, duplicates: 6, distanceMeters: 60 });
    // overlapping batch: only the new fixes count
    const overlap = await upload(id, walkerKey, walkFixes(4, 4).map((p, i) => ({ ...p, ts: Date.now() - (4 - i) * 1_000 })));
    expect(overlap.json).toMatchObject({ accepted: 2, duplicates: 2 });

    const w = await db.walk.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(w.trackJson)).toHaveLength(8);
    expect(await db.walkTrackPoint.count({ where: { walkId: id } })).toBe(8);
    const detail = await call(walkRoute.GET as H, { params: { id }, cookie: cookies.ana });
    expect(detail.json.lastSeq).toBe(7);
  });

  test("implausible fixes are stored as rejected and do not move the walk", async () => {
    const id = await newWalk("IN_PROGRESS");
    const now = Date.now();
    const r = await upload(id, walkerKey, [
      { seq: 0, ...north(10), ts: now - 30_000, acc: 5 },
      { seq: 1, ...north(400), ts: now - 20_000, acc: 5 }, // 390 m in 10 s
      { seq: 2, ...north(20), ts: now - 40_000, acc: 5 }, // older than seq 0
      { seq: 3, ...north(5_000), ts: now - 10_000, acc: 5 }, // teleport
    ]);
    expect(r.status).toBe(200);
    expect(r.json.accepted).toBe(1);
    expect(r.json.rejected).toEqual([
      { seq: 1, reason: "too_fast" },
      { seq: 2, reason: "out_of_order" },
      { seq: 3, reason: "teleport" },
    ]);
    expect(r.json.distanceMeters).toBe(0);
    const w = await db.walk.findUniqueOrThrow({ where: { id } });
    expect(w.rejectedPoints).toBe(3);
    expect(JSON.parse(w.trackJson)).toHaveLength(1);
  });

  test("a mock location flags the walk and is audited once", async () => {
    const id = await newWalk("IN_PROGRESS");
    const now = Date.now();
    await upload(id, walkerKey, [{ seq: 0, ...north(10), ts: now - 2_000, acc: 5, mock: true }]);
    await upload(id, walkerKey, [{ seq: 1, ...north(12), ts: now - 1_000, acc: 5, mock: true }]);
    const w = await db.walk.findUniqueOrThrow({ where: { id } });
    expect(w.mockLocation).toBe(true);
    expect(await db.auditLog.count({ where: { action: "WALK_MOCK_LOCATION", entityId: id } })).toBe(1);
  });

  test("the start position anchors the first fix (no teleporting the whole route)", async () => {
    const id = await newWalk("IN_PROGRESS");
    const elsewhere = north(3_000);
    const r = await upload(id, walkerKey, [{ seq: 0, ...elsewhere, ts: Date.now() - 1_000, acc: 5 }]);
    expect(r.json.rejected).toEqual([{ seq: 0, reason: "teleport" }]);
    expect(haversineMeters(HOME, elsewhere)).toBeGreaterThan(rules.maxJumpMeters);
  });
});

describe("POST /api/admin/walks/[id]/override", () => {
  const grant = (id: string, who: keyof typeof PHONES, body: unknown) =>
    call(overrideRoute.POST as H, { method: "POST", params: { id }, cookie: cookies[who], body });

  test("only admins, with a phase and a reason", async () => {
    const id = await newWalk();
    expect((await grant(id, walkerKey, { phase: "start", reason: "GPS roto" })).status).toBe(403);
    expect((await grant(id, "ana", { phase: "start", reason: "GPS roto" })).status).toBe(403);
    expect((await grant(id, "admin", { phase: "start" })).status).toBe(400);
    expect((await grant(id, "admin", { phase: "start", reason: "x" })).status).toBe(400);
    expect((await grant(id, "admin", { phase: "end", reason: "Pin mal ubicado" })).status).toBe(400);
  });

  test("an override lets the walker start and finish away from the pickup, once, with audit", async () => {
    const id = await newWalk();
    expect((await grant(id, "admin", { phase: "start", reason: "Pin del dueño mal ubicado" })).status).toBe(200);
    const start = await patch(id, walkerKey, { action: "start", ...north(800) });
    expect(start.status).toBe(200);
    let w = await db.walk.findUniqueOrThrow({ where: { id } });
    expect(w.startOverride).toBeNull(); // consumed
    expect(w.startDistanceM).toBeGreaterThan(790);

    // the end still needs the geofence until an admin allows it
    expect((await patch(id, walkerKey, { action: "finish", report, ...north(800) })).status).toBe(400);
    expect((await grant(id, "admin", { phase: "end", reason: "Pin del dueño mal ubicado" })).status).toBe(200);
    expect((await patch(id, walkerKey, { action: "finish", report })).status).toBe(200);
    w = await db.walk.findUniqueOrThrow({ where: { id } });
    expect(w.status).toBe("COMPLETED");
    expect(w.endOverride).toBeNull();

    const audit = await db.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual([
      "WALK_GEOFENCE_OVERRIDE",
      "WALK_GEOFENCE_OVERRIDE_USED",
      "WALK_GEOFENCE_OVERRIDE",
      "WALK_GEOFENCE_OVERRIDE_USED",
    ]);
    expect(audit[0].actorId).toBe(ids.admin);
    expect(audit[1].actorId).toBe(ids[walkerKey]);
  });
});
