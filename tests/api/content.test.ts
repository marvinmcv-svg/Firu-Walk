/// <reference types="bun-types" />
// Phase 3 content: owner / walker consent, "Firu del mes" and walker
// spotlights curated by admins, and the public landing endpoint that only
// shows people who (still) consent.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as featuredRoute from "@/app/api/content/featured/route";
import * as contentRoute from "@/app/api/admin/content/route";
import * as featureRoute from "@/app/api/admin/content/[id]/route";
import * as meRoute from "@/app/api/users/me/route";
import * as walkRoute from "@/app/api/walks/[id]/route";
import { boMonth, publicName } from "@/lib/server/content";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { call, cookieFor, PHONES, userId } from "./helpers";
import type { H } from "./flows";

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const month = boMonth();

async function featured() {
  const r = await call(featuredRoute.GET as unknown as H);
  expect(r.status).toBe(200);
  return r.json as {
    firu: { id: string; dogName: string; photoUrl: string | null } | null;
    spotlights: { id: string; walkerName: string }[];
  };
}

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  await db.rateLimit.deleteMany();
  for (const k of ["admin", "ana", "carlos", "luis", "gabriela", "jose"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
});

afterAll(async () => {
  setRealtimePublisherForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

describe("helpers", () => {
  test("Bolivia month and public names", () => {
    // 2026-12-01 02:00 UTC is still 30 Nov in Bolivia (UTC-4).
    expect(boMonth(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11");
    expect(boMonth(new Date("2026-01-15T12:00:00Z"), -1)).toBe("2025-12");
    expect(publicName("Luis Fernando Quispe")).toBe("Luis Fernando Q.");
    expect(publicName("Camila")).toBe("Camila");
  });
});

describe("public featured content", () => {
  test("shows the seeded Firu del mes and spotlights, without full names", async () => {
    const f = await featured();
    expect(f.firu?.dogName).toBe("Max");
    expect(f.spotlights.length).toBe(2);
    for (const s of f.spotlights) expect(s.walkerName).toMatch(/ [A-ZÁÉÍÓÚÑ]\.$/);
    const raw = JSON.stringify(f);
    expect(raw).not.toContain(ids.ana);
    expect(raw).not.toContain("+591");
  });

  test("an owner withdrawing consent removes their dog at once (audited)", async () => {
    const off = await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.ana, body: { mediaConsent: false } });
    expect(off.status).toBe(200);
    expect(off.json.mediaConsent).toBe(false);
    expect((await featured()).firu).toBeNull();
    const audit = await db.auditLog.findFirst({ where: { action: "CONSENT_CHANGED", actorId: ids.ana }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(audit!.detail!)).toEqual({ mediaConsent: false });

    const on = await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.ana, body: { mediaConsent: true } });
    expect(on.json.mediaConsent).toBe(true);
    expect((await featured()).firu?.dogName).toBe("Max");
  });

  test("a walker withdrawing consent leaves the spotlights", async () => {
    const off = await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.luis, body: { spotlightConsent: false } });
    expect(off.status).toBe(200);
    expect(off.json.walker.spotlightConsent).toBe(false);
    expect((await featured()).spotlights.length).toBe(1);
    await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.luis, body: { spotlightConsent: true } });
    expect((await featured()).spotlights.length).toBe(2);
  });

  test("consent fields belong to their role", async () => {
    expect((await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.luis, body: { mediaConsent: true } })).status).toBe(400);
    expect((await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.ana, body: { spotlightConsent: true } })).status).toBe(400);
  });

  test("the walker sees whether the owner allows the photos", async () => {
    const walk = await db.walk.findFirstOrThrow({ where: { ownerId: ids.ana, walkerId: ids.luis } });
    const r = await call(walkRoute.GET as H, { params: { id: walk.id }, cookie: cookies.luis });
    expect(r.status).toBe(200);
    expect(r.json.ownerMediaConsent).toBe(true);
  });
});

describe("admin: content", () => {
  test("only admins", async () => {
    expect((await call(contentRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);
    const r = await call(contentRoute.POST as H, { method: "POST", cookie: cookies.luis, body: { kind: "FIRU_OF_MONTH" } });
    expect(r.status).toBe(403);
  });

  test("overview lists only consenting owners' dogs and their walk photos", async () => {
    const r = await call(contentRoute.GET as H, { cookie: cookies.admin });
    expect(r.status).toBe(200);
    expect(r.json.month).toBe(month);
    const anaDogs = await db.dog.findMany({ where: { ownerId: ids.ana } });
    expect(r.json.dogs.map((d: { id: string }) => d.id).sort()).toEqual(anaDogs.map((d) => d.id).sort());
    expect(r.json.media.length).toBeGreaterThan(0);
    for (const m of r.json.media) expect(anaDogs.some((d) => d.id === m.dogId)).toBe(true);
    expect(r.json.walkers.map((w: { id: string }) => w.id)).toContain(ids.luis);
    expect(r.json.consentCounts.owners).toBe(1);
    expect(r.json.features.length).toBe(3);
  });

  test("refuses dogs and walkers without consent, foreign photos and a second Firu", async () => {
    const luna = await db.dog.findFirstOrThrow({ where: { ownerId: ids.carlos } });
    const coco = await db.dog.findFirstOrThrow({ where: { ownerId: ids.ana, name: "Coco" } });
    const base = { kind: "FIRU_OF_MONTH", month, headline: "Coco del mes", blurb: "Una perrita muy especial." };
    const post = (body: Record<string, unknown>) => call(contentRoute.POST as H, { method: "POST", cookie: cookies.admin, body });

    expect((await post({ ...base, dogId: luna.id })).json.error).toContain("no autorizó");
    expect((await post({ ...base, dogId: coco.id })).json.error).toContain("Ya hay un Firu del mes");
    expect((await post({ ...base, dogId: coco.id, published: false, photoUrl: "https://evil.example/x.png" })).json.error).toContain(
      "fotos propuestas"
    );
    const spot = { kind: "WALKER_SPOTLIGHT", month, headline: "Destacada", blurb: "Una paseadora muy especial." };
    expect((await post({ ...spot, walkerId: ids.gabriela })).json.error).toContain("no autorizó");
    expect((await post({ ...spot, walkerId: ids.jose })).status).toBe(400); // pending walker
    expect((await post({ ...base, month: "2026-13", dogId: coco.id })).status).toBe(400);
  });

  test("hide one Firu, publish another, then delete", async () => {
    const max = await db.feature.findFirstOrThrow({ where: { kind: "FIRU_OF_MONTH" } });
    const hide = await call(featureRoute.PATCH as H, { method: "PATCH", params: { id: max.id }, cookie: cookies.admin, body: { published: false } });
    expect(hide.status).toBe(200);
    expect(hide.json.live).toBe(false);
    expect((await featured()).firu).toBeNull();

    const coco = await db.dog.findFirstOrThrow({ where: { ownerId: ids.ana, name: "Coco" } });
    const created = await call(contentRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { kind: "FIRU_OF_MONTH", month, dogId: coco.id, headline: "Coco del mes", blurb: "Una perrita muy especial.", photoUrl: coco.photoUrl },
    });
    expect(created.status).toBe(201);
    expect(created.json.live).toBe(true);
    expect((await featured()).firu?.dogName).toBe("Coco");

    // Max can't come back while Coco holds the month.
    const again = await call(featureRoute.PATCH as H, { method: "PATCH", params: { id: max.id }, cookie: cookies.admin, body: { published: true } });
    expect(again.status).toBe(400);

    const del = await call(featureRoute.DELETE as H, { method: "DELETE", params: { id: created.json.id }, cookie: cookies.admin });
    expect(del.status).toBe(200);
    expect(await db.feature.findUnique({ where: { id: created.json.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { entity: "feature", entityId: created.json.id } })).toBe(2);
  });

  test("an old month's Firu stops showing after three months", async () => {
    const max = await db.feature.findFirstOrThrow({ where: { kind: "FIRU_OF_MONTH" } });
    await db.feature.update({ where: { id: max.id }, data: { published: true, month: boMonth(new Date(), -3) } });
    expect((await featured()).firu).toBeNull();
    await db.feature.update({ where: { id: max.id }, data: { month: boMonth(new Date(), -2) } });
    expect((await featured()).firu?.dogName).toBe("Max");
  });
});
