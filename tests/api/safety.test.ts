/// <reference types="bun-types" />
// Milestone 8 — safety & ops:
//   - SOS on an active walk: incident with position, owner + ops alerted,
//     nearest vets, no duplicate alerts, only the assigned walker
//   - late-start detection → owner + ops alerted, backup chain (offer,
//     decline, accept, expiry, exhaustion, cleared when the walk starts)
//   - minute job: single-flight, accept-timeout sweep, walker reminders
//   - admin: incident queue, live ops view, leaderboard, vets, ops phones config

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as sosRoute from "@/app/api/walks/[id]/sos/route";
import * as backupRoute from "@/app/api/walks/[id]/backup/route";
import * as offersRoute from "@/app/api/walks/backup-offers/route";
import * as walkRoute from "@/app/api/walks/[id]/route";
import * as vetsRoute from "@/app/api/vets/route";
import * as adminVets from "@/app/api/admin/vets/route";
import * as adminVet from "@/app/api/admin/vets/[id]/route";
import * as incidentsRoute from "@/app/api/admin/incidents/route";
import * as incidentRoute from "@/app/api/admin/incidents/[id]/route";
import * as liveRoute from "@/app/api/admin/ops/live/route";
import * as boardRoute from "@/app/api/admin/ops/leaderboard/route";
import * as adminConfig from "@/app/api/admin/config/route";
import * as publicConfig from "@/app/api/config/route";
import * as cronMinute from "@/app/api/cron/minute/route";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import {
  clearMockOutbox,
  MockPushSender,
  MockWhatsAppSender,
  mockOutbox,
  setChannelsForTests,
} from "@/lib/server/notifications/channels";
import { parseOpsPhones } from "@/lib/server/safety/opsAlerts";
import { call, cookieFor, PHONES, userId } from "./helpers";

type H = Parameters<typeof call>[0];
const CRON = "cron-secret-for-safety-tests-0123";
const OPS_PHONE = "+59171234567";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const DIEGO = "+59170000203";
let ana: { dogId: string; zoneId: string; lat: number; lng: number };

function whatsapps(template?: string) {
  return mockOutbox().filter(
    (m): m is Extract<(typeof m), { channel: "whatsapp" }> =>
      m.channel === "whatsapp" && (!template || m.template === template)
  );
}

function minuteJob() {
  return call(cronMinute.GET as H, { headers: { authorization: `Bearer ${CRON}` } });
}

/** A booking of Ana's dog with a controlled candidate chain + one walk. */
async function makeWalk(opts: {
  walker: string;
  candidates?: string[];
  startInMin: number;
  status?: "SCHEDULED" | "IN_PROGRESS";
}) {
  const booking = await db.booking.create({
    data: {
      ownerId: ids.ana,
      dogId: ana.dogId,
      walkerId: opts.walker,
      zoneId: ana.zoneId,
      type: "ONE_OFF",
      status: "CONFIRMED",
      scheduleJson: "[]",
      durationMin: 30,
      pricePerWalkCents: 1500,
      candidatesJson: JSON.stringify(opts.candidates ?? [opts.walker]),
    },
  });
  const start = new Date(Date.now() + opts.startInMin * 60_000);
  return db.walk.create({
    data: {
      bookingId: booking.id,
      walkerId: opts.walker,
      ownerId: ids.ana,
      dogId: ana.dogId,
      zoneId: ana.zoneId,
      status: opts.status ?? "SCHEDULED",
      scheduledStart: start,
      durationMin: 30,
      ...(opts.status === "IN_PROGRESS" ? { startedAt: start } : {}),
      // Already reminded: keeps reminder messages out of unrelated tests.
      reminderSentAt: new Date(),
    },
  });
}

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  setChannelsForTests({ whatsapp: new MockWhatsAppSender(), push: new MockPushSender() });
  process.env.CRON_SECRET = CRON;
  for (const k of ["admin", "ana", "carlos", "luis", "gabriela"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
  cookies.diego = await cookieFor(DIEGO);
  ids.diego = await userId(DIEGO);
  const a = await db.user.findUniqueOrThrow({ where: { phone: PHONES.ana }, include: { dogs: true } });
  ana = { dogId: a.dogs[0].id, zoneId: a.zoneId!, lat: a.addressLat!, lng: a.addressLng!, };

  // Clean slate for the walkers used here: no other walks in progress or
  // around now (keeps them eligible as backups and out of the live view).
  await db.walk.updateMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      OR: [
        { status: "IN_PROGRESS" },
        { scheduledStart: { gt: new Date(Date.now() - 8 * 3_600_000), lt: new Date(Date.now() + 3 * 3_600_000) } },
      ],
    },
    data: { status: "CANCELLED", cancelReason: "safety test setup" },
  });

  const cfg = await call(adminConfig.PATCH as H, {
    method: "PATCH",
    cookie: cookies.admin,
    body: { section: "safety", patch: { opsWhatsApp: OPS_PHONE } },
  });
  expect(cfg.status).toBe(200);
});

beforeEach(() => clearMockOutbox());

afterAll(async () => {
  delete process.env.CRON_SECRET;
  setRealtimePublisherForTests(null);
  setChannelsForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

// ---------------------------------------------------------------------------

describe("ops phones config", () => {
  test("parses, validates and stays private", async () => {
    expect(parseOpsPhones("+591 7123-4567, +59170000001")).toEqual(["+59171234567", "+59170000001"]);
    expect(parseOpsPhones("")).toEqual([]);
    expect(parseOpsPhones("7123")).toBeNull();

    const bad = await call(adminConfig.PATCH as H, {
      method: "PATCH",
      cookie: cookies.admin,
      body: { section: "safety", patch: { opsWhatsApp: "llamar a Juan" } },
    });
    expect(bad.status).toBe(400);

    const asOwner = await call(publicConfig.GET as H, { cookie: cookies.ana });
    expect(asOwner.json.safety.opsWhatsApp).toBe("");
    expect(asOwner.json.safety.lateStartMinutes).toBe(10);
    const asAdmin = await call(publicConfig.GET as H, { cookie: cookies.admin });
    expect(asAdmin.json.safety.opsWhatsApp).toBe(OPS_PHONE);
  });
});

describe("SOS", () => {
  let walkId: string;
  let incidentId: string;

  beforeAll(async () => {
    walkId = (await makeWalk({ walker: ids.luis, startInMin: -10, status: "IN_PROGRESS" })).id;
  });

  test("only the assigned walker, only during the walk", async () => {
    const asOwner = await call(sosRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.ana, body: {} });
    expect(asOwner.status).toBe(403);
    const other = await call(sosRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.gabriela, body: {} });
    expect(other.status).toBe(403);
    const scheduled = await makeWalk({ walker: ids.luis, startInMin: 120 });
    const early = await call(sosRoute.POST as H, { method: "POST", params: { id: scheduled.id }, cookie: cookies.luis, body: {} });
    expect(early.status).toBe(400);
    await db.walk.update({ where: { id: scheduled.id }, data: { status: "CANCELLED" } });
    const badPos = await call(sosRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.luis, body: { lat: 200, lng: 0 } });
    expect(badPos.status).toBe(400);
    expect(await db.incidentLog.count({ where: { walkId } })).toBe(0);
  });

  test("logs the incident, alerts owner + ops, returns nearest vets", async () => {
    const pos = { lat: -17.7668, lng: -63.1955 }; // next to the demo Equipetrol vet
    const r = await call(sosRoute.POST as H, {
      method: "POST",
      params: { id: walkId },
      cookie: cookies.luis,
      body: { ...pos, note: "Max se cortó una pata" },
    });
    expect(r.status).toBe(201);
    expect(r.json.repeated).toBe(false);
    expect(r.json.position).toEqual(pos);
    expect(r.json.vets.length).toBeGreaterThan(0);
    expect(r.json.vets[0].name).toContain("Equipetrol");
    const d = r.json.vets.map((v: { distanceM: number }) => v.distanceM);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    incidentId = r.json.incidentId;

    const inc = await db.incidentLog.findUniqueOrThrow({ where: { id: incidentId } });
    expect(inc).toMatchObject({ type: "SOS", status: "OPEN", subjectUserId: ids.luis, lat: pos.lat, lng: pos.lng });
    expect(inc.note).toContain("pata");

    const owner = whatsapps("firuwalk_walk_sos");
    expect(owner).toHaveLength(1);
    expect(owner[0].to).toBe(PHONES.ana);
    expect(owner[0].params[2]).toContain(`?walk=${walkId}`);
    const ops = whatsapps("firuwalk_ops_alert");
    expect(ops).toHaveLength(1);
    expect(ops[0].to).toBe(OPS_PHONE);
    expect(ops[0].params[0]).toBe("SOS");
    expect(ops[0].params[2]).toBe("https://maps.google.com/?q=-17.766800,-63.195500");
    expect(await db.notification.count({ where: { userId: ids.admin, title: { contains: "SOS" } } })).toBeGreaterThan(0);
    expect(await db.auditLog.count({ where: { action: "SOS_TRIGGERED", entityId: walkId } })).toBe(1);
  });

  test("pressing again does not alert twice", async () => {
    const r = await call(sosRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.luis, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.repeated).toBe(true);
    expect(r.json.incidentId).toBe(incidentId);
    expect(whatsapps()).toHaveLength(0);
  });

  test("the admin live view flags the walk; the queue lists and resolves it", async () => {
    await db.walkTrackPoint.create({ data: { walkId, seq: 0, lat: -17.7669, lng: -63.1956 } });
    const live = await call(liveRoute.GET as H, { cookie: cookies.admin });
    expect(live.status).toBe(200);
    const row = live.json.inProgress.find((w: { walkId: string }) => w.walkId === walkId);
    expect(row).toMatchObject({ openSos: true, last: [-17.7669, -63.1956], walkerName: "Luis Quisbert" });
    expect(live.json.openIncidents).toBeGreaterThanOrEqual(1);
    expect((await call(liveRoute.GET as H, { cookie: cookies.luis })).status).toBe(403);

    const list = await call(incidentsRoute.GET as H, { cookie: cookies.admin, path: "/api/admin/incidents?status=OPEN" });
    expect(list.status).toBe(200);
    expect(list.json[0]).toMatchObject({ id: incidentId, type: "SOS", reporterName: "Luis Quisbert" });
    expect(list.json[0].mapsUrl).toContain("maps.google.com");
    expect(list.json[0].walk.ownerPhone).toBe(PHONES.ana);
    expect((await call(incidentsRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);

    const empty = await call(incidentRoute.PATCH as H, { method: "PATCH", params: { id: incidentId }, cookie: cookies.admin, body: { resolution: "" } });
    expect(empty.status).toBe(400);
    const notAdmin = await call(incidentRoute.PATCH as H, { method: "PATCH", params: { id: incidentId }, cookie: cookies.luis, body: { resolution: "ok ok" } });
    expect(notAdmin.status).toBe(403);
    const done = await call(incidentRoute.PATCH as H, {
      method: "PATCH",
      params: { id: incidentId },
      cookie: cookies.admin,
      body: { resolution: "Llevado a la veterinaria, todo bien." },
    });
    expect(done.status).toBe(200);
    const again = await call(incidentRoute.PATCH as H, { method: "PATCH", params: { id: incidentId }, cookie: cookies.admin, body: { resolution: "otra vez" } });
    expect(again.status).toBe(400);
    expect(await db.incidentLog.findUniqueOrThrow({ where: { id: incidentId } })).toMatchObject({
      status: "RESOLVED",
      resolvedById: ids.admin,
    });
    await db.walk.update({ where: { id: walkId }, data: { status: "COMPLETED", endedAt: new Date() } });
  });
});

describe("late start → backup chain", () => {
  let walkId: string;

  test("a walk not started 10 min after its time alerts owner + ops and offers a backup", async () => {
    const walk = await makeWalk({ walker: ids.luis, candidates: [ids.luis, ids.diego, ids.gabriela], startInMin: -12 });
    walkId = walk.id;
    // Not late yet at 5 minutes:
    const notYet = await makeWalk({ walker: ids.luis, startInMin: -5 });

    const r = await minuteJob();
    expect(r.status).toBe(200);
    expect(r.json.lateAlerted).toBe(1);

    const inc = await db.incidentLog.findFirstOrThrow({ where: { walkId, type: "LATE" } });
    expect(inc).toMatchObject({ reportedBy: "system", subjectUserId: ids.luis, status: "OPEN" });
    expect(await db.incidentLog.count({ where: { walkId: notYet.id } })).toBe(0);

    const late = whatsapps("firuwalk_walk_late");
    expect(late).toHaveLength(1);
    expect(late[0].to).toBe(PHONES.ana);
    expect(Number(late[0].params[2])).toBeGreaterThanOrEqual(11);
    expect(whatsapps("firuwalk_ops_alert").map((m) => m.to)).toEqual([OPS_PHONE]);

    const offer = whatsapps("firuwalk_backup_offer");
    expect(offer).toHaveLength(1);
    expect(offer[0].to).toBe(DIEGO); // chain order, the late walker skipped
    const w = await db.walk.findUniqueOrThrow({ where: { id: walkId } });
    expect(w.backupWalkerId).toBe(ids.diego);
    expect(w.backupExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(JSON.parse(w.backupCandidatesJson).slice(0, 2)).toEqual([ids.diego, ids.gabriela]);
    await db.walk.update({ where: { id: notYet.id }, data: { status: "CANCELLED" } });
  });

  test("the minute job is idempotent", async () => {
    const r = await minuteJob();
    expect(r.json.lateAlerted).toBe(0);
    expect(whatsapps("firuwalk_walk_late")).toHaveLength(0);
    expect(whatsapps("firuwalk_backup_offer")).toHaveLength(0);
    expect(await db.incidentLog.count({ where: { walkId, type: "LATE" } })).toBe(1);
  });

  test("only the offered walker sees and answers the offer", async () => {
    const mine = await call(offersRoute.GET as H, { cookie: cookies.diego });
    expect(mine.status).toBe(200);
    expect(mine.json).toHaveLength(1);
    expect(mine.json[0]).toMatchObject({ walkId, dogName: "Max" });
    expect(JSON.stringify(mine.json)).not.toContain("addressNote");
    expect((await call(offersRoute.GET as H, { cookie: cookies.gabriela })).json).toHaveLength(0);
    expect((await call(offersRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);

    const steal = await call(backupRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.gabriela, body: { action: "accept" } });
    expect(steal.status).toBe(403);
    const bad = await call(backupRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.diego, body: { action: "maybe" } });
    expect(bad.status).toBe(400);
  });

  test("decline moves the offer to the next walker; accepting reassigns the walk", async () => {
    const no = await call(backupRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.diego, body: { action: "decline" } });
    expect(no.status).toBe(200);
    expect(whatsapps("firuwalk_backup_offer").map((m) => m.to)).toEqual([PHONES.gabriela]);

    const yes = await call(backupRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.gabriela, body: { action: "accept" } });
    expect(yes.status).toBe(200);
    const w = await db.walk.findUniqueOrThrow({ where: { id: walkId } });
    expect(w).toMatchObject({ walkerId: ids.gabriela, originalWalkerId: ids.luis, backupWalkerId: null, status: "SCHEDULED" });
    const reassigned = whatsapps("firuwalk_walk_reassigned");
    expect(reassigned).toHaveLength(1);
    expect(reassigned[0].to).toBe(PHONES.ana);
    expect(await db.auditLog.count({ where: { action: "WALK_REASSIGNED_BACKUP", entityId: walkId } })).toBe(1);

    // The late walker can no longer start it; the backup can see it.
    const start = await call(walkRoute.PATCH as H, {
      method: "PATCH",
      params: { id: walkId },
      cookie: cookies.luis,
      body: { action: "start", lat: ana.lat, lng: ana.lng },
    });
    expect(start.status).toBe(403);
    const view = await call(walkRoute.GET as H, { params: { id: walkId }, cookie: cookies.gabriela });
    expect(view.status).toBe(200);
    const again = await call(backupRoute.POST as H, { method: "POST", params: { id: walkId }, cookie: cookies.gabriela, body: { action: "accept" } });
    expect(again.status).toBe(403);
    await db.walk.update({ where: { id: walkId }, data: { status: "CANCELLED" } });
  });

  test("an expired offer moves on; an exhausted chain tells the owner and ops", async () => {
    const walk = await makeWalk({ walker: ids.luis, startInMin: -20 });
    await db.walk.update({
      where: { id: walk.id },
      data: {
        lateAlertedAt: new Date(),
        backupCandidatesJson: JSON.stringify([ids.diego]),
        backupIdx: 0,
        backupWalkerId: ids.diego,
        backupExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const r = await minuteJob();
    expect(r.json.backupOffersAdvanced).toBe(1);
    const w = await db.walk.findUniqueOrThrow({ where: { id: walk.id } });
    expect(w).toMatchObject({ backupWalkerId: null, backupIdx: 1, walkerId: ids.luis });
    expect(whatsapps("firuwalk_backup_none").map((m) => m.to)).toEqual([PHONES.ana]);
    expect(whatsapps("firuwalk_ops_alert")[0].params[0]).toBe("Sin respaldo");
    const late = await call(liveRoute.GET as H, { cookie: cookies.admin });
    expect(late.json.late.find((l: { walkId: string }) => l.walkId === walk.id)).toMatchObject({ backupExhausted: true });

    // Accepting an expired offer fails too.
    await db.walk.update({ where: { id: walk.id }, data: { backupWalkerId: ids.diego, backupExpiresAt: new Date(Date.now() - 1) } });
    const stale = await call(backupRoute.POST as H, { method: "POST", params: { id: walk.id }, cookie: cookies.diego, body: { action: "accept" } });
    expect(stale.status).toBe(400);
    await db.walk.update({ where: { id: walk.id }, data: { status: "CANCELLED", backupWalkerId: null } });
  });

  test("the late walker starting the walk cancels the pending offer", async () => {
    const walk = await makeWalk({ walker: ids.luis, candidates: [ids.luis, ids.diego], startInMin: -11 });
    await minuteJob();
    expect((await db.walk.findUniqueOrThrow({ where: { id: walk.id } })).backupWalkerId).toBe(ids.diego);
    const start = await call(walkRoute.PATCH as H, {
      method: "PATCH",
      params: { id: walk.id },
      cookie: cookies.luis,
      body: { action: "start", lat: ana.lat, lng: ana.lng },
    });
    expect(start.status).toBe(200);
    const w = await db.walk.findUniqueOrThrow({ where: { id: walk.id } });
    expect(w).toMatchObject({ status: "IN_PROGRESS", backupWalkerId: null, walkerId: ids.luis });
    expect(await db.notification.count({ where: { userId: ids.diego, title: "Respaldo ya no necesario" } })).toBe(1);
    await db.walk.update({ where: { id: walk.id }, data: { status: "COMPLETED", endedAt: new Date() } });
  });
});

describe("scheduled jobs", () => {
  test("cron auth, single flight and run history", async () => {
    expect((await call(cronMinute.GET as H, {})).status).toBe(401);
    await db.jobLock.update({ where: { job: "minute" }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const busy = await minuteJob();
    expect(busy.json).toEqual({ skipped: true });
    await db.jobLock.update({ where: { job: "minute" }, data: { lockedUntil: new Date(0) } });
    const ran = await minuteJob();
    expect(ran.json.runId).toBeString();
    const run = await db.jobRun.findUniqueOrThrow({ where: { id: ran.json.runId } });
    expect(run).toMatchObject({ job: "minute", trigger: "cron", ok: true });
    const live = await call(liveRoute.GET as H, { cookie: cookies.admin });
    const minute = live.json.jobs.find((j: { job: string }) => j.job === "minute");
    expect(Date.now() - new Date(minute.lastOkAt).getTime()).toBeLessThan(60_000);
  });

  test("expired booking requests move to the next candidate", async () => {
    const booking = await db.booking.create({
      data: {
        ownerId: ids.ana,
        dogId: ana.dogId,
        walkerId: ids.luis,
        zoneId: ana.zoneId,
        type: "ONE_OFF",
        status: "REQUESTED",
        scheduleJson: "[]",
        pricePerWalkCents: 1500,
        candidatesJson: JSON.stringify([ids.luis, ids.diego]),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const r = await minuteJob();
    expect(r.json.requestsSwept).toBeGreaterThanOrEqual(1);
    const b = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b).toMatchObject({ status: "REQUESTED", walkerId: ids.diego, candidateIdx: 1 });
    expect(b.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    await db.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
  });

  test("walkers are reminded once before a walk", async () => {
    const walk = await makeWalk({ walker: ids.luis, startInMin: 40 });
    await db.walk.update({ where: { id: walk.id }, data: { reminderSentAt: null } });
    const far = await makeWalk({ walker: ids.luis, startInMin: 180 });
    await db.walk.update({ where: { id: far.id }, data: { reminderSentAt: null } });

    const r = await minuteJob();
    expect(r.json.remindersSent).toBe(1);
    const sent = whatsapps("firuwalk_walk_reminder");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONES.luis);
    expect(sent[0].params[0]).toBe("Max");
    expect(sent[0].params[1]).toMatch(/^\d{2}:\d{2}$/);
    clearMockOutbox();
    expect((await minuteJob()).json.remindersSent).toBe(0);
    expect((await db.walk.findUniqueOrThrow({ where: { id: far.id } })).reminderSentAt).toBeNull();
    await db.walk.updateMany({ where: { id: { in: [walk.id, far.id] } }, data: { status: "CANCELLED" } });
  });
});

describe("leaderboard", () => {
  test("on-time %, no-shows and SOS per walker; admin only", async () => {
    expect((await call(boardRoute.GET as H, { cookie: cookies.luis })).status).toBe(403);
    const r = await call(boardRoute.GET as H, { cookie: cookies.admin, path: "/api/admin/ops/leaderboard?days=30" });
    expect(r.status).toBe(200);
    const luis = r.json.find((row: { userId: string }) => row.userId === ids.luis);
    // Reassigned to Gabriela + left unstarted (exhausted chain) don't both count yet:
    // the reassigned one does; unstarted ones count after 2 h.
    expect(luis.noShows).toBeGreaterThanOrEqual(1);
    expect(luis.sosCount).toBe(1);
    expect(luis.walksStarted).toBeGreaterThanOrEqual(2);
    expect(luis.onTimePct).toBeLessThan(100); // started 11 min late
    const gabriela = r.json.find((row: { userId: string }) => row.userId === ids.gabriela);
    expect(gabriela.noShows).toBe(0);
    expect(r.json.some((row: { status: string }) => row.status === "PENDING")).toBe(false);
  });
});

describe("vets", () => {
  test("admins manage the list; everyone signed in gets the nearest", async () => {
    const body = { name: "Vet Test 24h", phone: "+59133334444", address: "Calle 1", lat: -17.79, lng: -63.2, open24h: true };
    expect((await call(adminVets.POST as H, { method: "POST", cookie: cookies.luis, body })).status).toBe(403);
    expect((await call(adminVets.POST as H, { method: "POST", cookie: cookies.admin, body: { ...body, lat: 999 } })).status).toBe(400);
    const created = await call(adminVets.POST as H, { method: "POST", cookie: cookies.admin, body });
    expect(created.status).toBe(201);
    const id = created.json.id;

    const near = await call(vetsRoute.GET as H, { cookie: cookies.luis, path: "/api/vets?lat=-17.7901&lng=-63.2001" });
    expect(near.status).toBe(200);
    expect(near.json[0].id).toBe(id);
    expect(near.json[0].distanceM).toBeLessThan(50);
    expect((await call(vetsRoute.GET as H, {})).status).toBe(401);

    const off = await call(adminVet.PATCH as H, { method: "PATCH", params: { id }, cookie: cookies.admin, body: { active: false } });
    expect(off.json.active).toBe(false);
    const after = await call(vetsRoute.GET as H, { cookie: cookies.luis, path: "/api/vets?lat=-17.7901&lng=-63.2001" });
    expect(after.json.some((v: { id: string }) => v.id === id)).toBe(false);
    const all = await call(adminVets.GET as H, { cookie: cookies.admin });
    expect(all.json.some((v: { id: string }) => v.id === id)).toBe(true);
    expect((await call(adminVet.DELETE as H, { method: "DELETE", params: { id }, cookie: cookies.admin })).status).toBe(200);
    expect(await db.vet.count({ where: { id } })).toBe(0);
  });
});
