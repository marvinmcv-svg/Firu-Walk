/// <reference types="bun-types" />
// Phase 3 expansion: cities with their own walk lengths, base prices and
// peak hours. Zones of cities not launched are invisible and unusable; admins
// create cities and zones, launch them and can't switch off ones with work.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import * as citiesRoute from "@/app/api/cities/route";
import * as zonesRoute from "@/app/api/zones/route";
import * as adminCitiesRoute from "@/app/api/admin/cities/route";
import * as adminCityRoute from "@/app/api/admin/cities/[id]/route";
import * as adminZonesRoute from "@/app/api/admin/zones/route";
import * as adminZoneRoute from "@/app/api/admin/zones/[id]/route";
import * as bookingsRoute from "@/app/api/bookings/route";
import * as applyRoute from "@/app/api/walkers/apply/route";
import * as meRoute from "@/app/api/users/me/route";
import { zoneUtilization } from "@/lib/server/growthMetrics";
import { runFirulaiTool, type ToolContext } from "@/lib/server/firulai/tools";
import { activeCities } from "@/lib/server/cities";
import { getAppConfig } from "@/lib/server/config";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { call, cookieFor, PHONES, userId } from "./helpers";
import { dayAhead, type H } from "./flows";

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

const zoneKeys = async (path = "/api/zones") =>
  ((await call(zonesRoute.GET as H, { path })).json as { key: string }[]).map((z) => z.key);

beforeAll(async () => {
  setRealtimePublisherForTests(async () => {});
  await db.rateLimit.deleteMany();
  for (const k of ["admin", "ana"] as const) {
    cookies[k] = await cookieFor(PHONES[k]);
    ids[k] = await userId(PHONES[k]);
  }
});

afterAll(async () => {
  setRealtimePublisherForTests(null);
  const r = Bun.spawnSync(["bun", "prisma/seed.ts"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`reseed failed:\n${r.stderr.toString()}`);
});

describe("public: only launched cities", () => {
  test("cities and zones hide La Paz and Cochabamba until launch", async () => {
    const cities = (await call(citiesRoute.GET as unknown as H)).json as { key: string; durations: number[] }[];
    expect(cities.map((c) => c.key)).toEqual(["santa-cruz"]);
    expect(cities[0].durations).toEqual([30, 45, 60]);
    const keys = await zoneKeys();
    expect(keys).toContain("equipetrol");
    expect(keys).not.toContain("sopocachi");
    expect(await zoneKeys("/api/zones?city=la-paz")).toEqual([]);
  });

  test("zones of a city not launched can't be used", async () => {
    const sopocachi = await db.zone.findUniqueOrThrow({ where: { key: "sopocachi" } });
    const me = await call(meRoute.PATCH as H, { method: "PATCH", cookie: cookies.ana, body: { zoneId: sopocachi.id } });
    expect(me.status).toBe(400);
    const apply = await call(applyRoute.POST as H, {
      method: "POST",
      body: { name: "Pedro Paz", phone: "+59170009001", bio: "Paseo perros en Sopocachi.", zoneId: sopocachi.id, experienceYears: 1, acceptAgreement: true },
    });
    expect(apply.status).toBe(400);
  });

  test("a booking without a chosen walker uses the city's base price", async () => {
    const ana = await db.user.findUniqueOrThrow({ where: { id: ids.ana }, include: { dogs: true } });
    await db.city.update({ where: { key: "santa-cruz" }, data: { price30Cents: 1700 } });
    const r = await call(bookingsRoute.POST as H, {
      method: "POST",
      cookie: cookies.ana,
      body: {
        dogId: ana.dogs[0].id,
        zoneId: ana.zoneId,
        type: "ONE_OFF",
        durationMin: 30,
        schedule: [{ date: dayAhead(3), minute: 600 }],
        paymentMethod: "QR",
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.pricePerWalkCents).toBe(1700);
    await db.city.update({ where: { key: "santa-cruz" }, data: { price30Cents: 1500 } });
  });
});

describe("admin: cities and zones", () => {
  test("only admins", async () => {
    expect((await call(adminCitiesRoute.GET as H, { cookie: cookies.ana })).status).toBe(403);
    expect((await call(adminZonesRoute.POST as H, { method: "POST", cookie: cookies.ana, body: {} })).status).toBe(403);
  });

  test("lists every city with zones and the expansion gate", async () => {
    const r = await call(adminCitiesRoute.GET as H, { cookie: cookies.admin });
    expect(r.status).toBe(200);
    expect(r.json.cities.map((c: { key: string }) => c.key)).toEqual(["santa-cruz", "la-paz", "cochabamba"]);
    const lp = r.json.cities.find((c: { key: string }) => c.key === "la-paz");
    expect(lp.active).toBe(false);
    expect(lp.durations).toEqual([30, 45]);
    expect(lp.zones.length).toBe(3);
    expect(r.json.occupancy.thresholdPct).toBe(70);
    expect(r.json.occupancy.zones).toBe(6);
  });

  test("validates new cities", async () => {
    const base = { name: "Tarija", centerLat: -21.53, centerLng: -64.73, price30Cents: 1500, price45Cents: 2000, price60Cents: 2500, durations: [30, 45], peaks: [[420, 570]] };
    const post = (body: Record<string, unknown>) => call(adminCitiesRoute.POST as H, { method: "POST", cookie: cookies.admin, body });
    expect((await post({ ...base, key: "Tarija!" })).status).toBe(400);
    expect((await post({ ...base, key: "tarija", peaks: [[600, 500]] })).status).toBe(400);
    expect((await post({ ...base, key: "tarija", durations: [] })).status).toBe(400);
    expect((await post({ ...base, key: "tarija", centerLat: 40 })).status).toBe(400); // not in Bolivia
    expect((await post({ ...base, key: "santa-cruz" })).json.error).toContain("Ya existe");

    const created = await post({ ...base, key: "tarija" });
    expect(created.status).toBe(201);
    expect(created.json.active).toBe(false);
    // Launch needs a zone.
    const launch = await call(adminCityRoute.PATCH as H, { method: "PATCH", params: { id: created.json.id }, cookie: cookies.admin, body: { active: true } });
    expect(launch.json.error).toContain("al menos una zona");
  });

  test("launching La Paz opens its zones with its own rules", async () => {
    const lp = await db.city.findUniqueOrThrow({ where: { key: "la-paz" } });
    const r = await call(adminCityRoute.PATCH as H, {
      method: "PATCH",
      params: { id: lp.id },
      cookie: cookies.admin,
      body: { active: true, price30Cents: 1800, price45Cents: 2300 },
    });
    expect(r.status).toBe(200);
    expect(r.json.active).toBe(true);
    expect(await db.auditLog.count({ where: { action: "CITY_LAUNCHED", entityId: lp.id } })).toBe(1);

    expect((await activeCities()).map((c) => c.key)).toEqual(["santa-cruz", "la-paz"]);
    expect(await zoneKeys("/api/zones?city=la-paz")).toEqual(["sopocachi", "calacoto", "san-miguel"]);

    // A walker applying in Sopocachi starts at La Paz prices.
    const sopocachi = await db.zone.findUniqueOrThrow({ where: { key: "sopocachi" } });
    const apply = await call(applyRoute.POST as H, {
      method: "POST",
      body: { name: "Pedro Paz", phone: "+59170009002", bio: "Paseo perros en Sopocachi.", zoneId: sopocachi.id, experienceYears: 1, acceptAgreement: true },
    });
    expect(apply.status).toBe(200);
    const profile = await db.walkerProfile.findFirstOrThrow({ where: { user: { phone: "+59170009002" } } });
    expect([profile.price30Cents, profile.price45Cents]).toEqual([1800, 2300]);

    // 60-minute walks aren't offered at La Paz's altitude.
    await db.user.update({ where: { id: ids.ana }, data: { zoneId: sopocachi.id } });
    const ana = await db.user.findUniqueOrThrow({ where: { id: ids.ana }, include: { dogs: true } });
    const b = await call(bookingsRoute.POST as H, {
      method: "POST",
      cookie: cookies.ana,
      body: { dogId: ana.dogs[0].id, zoneId: sopocachi.id, type: "ONE_OFF", durationMin: 60, schedule: [{ date: dayAhead(3), minute: 600 }], paymentMethod: "QR" },
    });
    expect(b.json.error).toContain("Duración no disponible");

    // Occupancy covers La Paz zones with La Paz peak hours.
    const rows = await zoneUtilization();
    expect(rows.find((z) => z.zoneId === sopocachi.id)?.cityName).toBe("La Paz");
  });

  test("add a zone; can't switch off zones or cities with pending work", async () => {
    const lp = await db.city.findUniqueOrThrow({ where: { key: "la-paz" } });
    const add = await call(adminZonesRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { cityId: lp.id, key: "miraflores", name: "Miraflores", centerLat: -16.4967, centerLng: -68.1203 },
    });
    expect(add.status).toBe(201);
    expect(await zoneKeys("/api/zones?city=la-paz")).toContain("miraflores");
    const dup = await call(adminZonesRoute.POST as H, {
      method: "POST",
      cookie: cookies.admin,
      body: { cityId: lp.id, key: "equipetrol", name: "Otra", centerLat: -16.5, centerLng: -68.1 },
    });
    expect(dup.json.error).toContain("Ya existe");

    const off = await call(adminZoneRoute.PATCH as H, { method: "PATCH", params: { id: add.json.id }, cookie: cookies.admin, body: { active: false } });
    expect(off.status).toBe(200);
    expect(await zoneKeys("/api/zones?city=la-paz")).not.toContain("miraflores");

    const equipetrol = await db.zone.findUniqueOrThrow({ where: { key: "equipetrol" } });
    const busyZone = await call(adminZoneRoute.PATCH as H, { method: "PATCH", params: { id: equipetrol.id }, cookie: cookies.admin, body: { active: false } });
    expect(busyZone.json.error).toContain("No se puede desactivar");
    const sc = await db.city.findUniqueOrThrow({ where: { key: "santa-cruz" } });
    const busyCity = await call(adminCityRoute.PATCH as H, { method: "PATCH", params: { id: sc.id }, cookie: cookies.admin, body: { active: false } });
    expect(busyCity.json.error).toContain("No se puede desactivar");
  });
});

describe("FirulAI quotes per city", () => {
  test("check_price uses the asked city's walk lengths and prices", async () => {
    const cities = await activeCities();
    const ctx: ToolContext = { cfg: await getAppConfig(), zones: [], cities, plans: [], appUrl: "https://x", lang: "es", actions: [] };
    const out = await runFirulaiTool("check_price", { city: "La Paz" }, ctx);
    const data = JSON.parse(out.content as string);
    expect(data.city).toBe("La Paz");
    expect(Object.keys(data.perWalk)).toEqual(["30", "45"]);
    expect(data.perWalk["30"]).toBe("Bs 18");
    expect(data.byCity.length).toBe(2);
    const sc = JSON.parse((await runFirulaiTool("check_price", {}, ctx)).content as string);
    expect(sc.city).toBe("Santa Cruz de la Sierra");
  });
});
