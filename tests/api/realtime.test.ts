/// <reference types="bun-types" />
// Milestone 3 — secure realtime: token/ticket issuing, server-side chat and
// GPS publishing, and the live-service refusing anything without valid tokens.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { io as ioClient, type Socket } from "socket.io-client";
import { db } from "@/lib/db";
import * as messages from "@/app/api/messages/route";
import * as realtimeToken from "@/app/api/realtime/token/route";
import * as track from "@/app/api/walks/[id]/track/route";
import { setRealtimePublisherForTests } from "@/lib/server/realtime";
import { createLiveServer, type LiveServer } from "../../mini-services/live-service/server";
import { DEV_REALTIME_SECRET, signToken } from "../../mini-services/live-service/token";
import { call, cookieFor, PHONES, userId } from "./helpers";

type H = Parameters<typeof call>[0];
const tokenRoute = realtimeToken.POST as H;

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let walkId: string; // ana's IN_PROGRESS walk, walked by its assigned walker
let walkerKey: keyof typeof PHONES;
let bookingId: string; // ana's booking (chat thread)

async function token(who: keyof typeof PHONES, room?: string) {
  return call(tokenRoute, { method: "POST", cookie: cookies[who], body: room ? { room } : {} });
}

function claimsOf(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}

beforeAll(async () => {
  for (const [k, phone] of Object.entries(PHONES)) {
    cookies[k] = await cookieFor(phone);
    ids[k] = await userId(phone);
  }
  const walk = await db.walk.findFirstOrThrow({ where: { ownerId: ids.ana, status: "IN_PROGRESS" } });
  walkId = walk.id;
  walkerKey = (Object.keys(ids) as (keyof typeof PHONES)[]).find((k) => ids[k] === walk.walkerId)!;
  expect(walkerKey).toBeDefined();
  bookingId = walk.bookingId;
});

describe("POST /api/realtime/token", () => {
  test("anonymous → 401", async () => {
    expect((await call(tokenRoute, { method: "POST", body: {} })).status).toBe(401);
  });

  test("connection token carries identity from the session", async () => {
    const r = await token("ana");
    expect(r.status).toBe(200);
    const c = claimsOf(r.json.token);
    expect(c).toMatchObject({ typ: "conn", sub: ids.ana, role: "OWNER" });
  });

  test("walk room: owner views, assigned walker drives, admin admins", async () => {
    const room = `walk:${walkId}`;
    expect(claimsOf((await token("ana", room)).json.token)).toMatchObject({
      typ: "room", sub: ids.ana, room, cap: "view", st: "IN_PROGRESS",
    });
    expect(claimsOf((await token(walkerKey, room)).json.token)).toMatchObject({ cap: "walker" });
    expect(claimsOf((await token("admin", room)).json.token)).toMatchObject({ cap: "admin" });
  });

  test("walk room: another owner or walker → 403", async () => {
    expect((await token("carlos", `walk:${walkId}`)).status).toBe(403);
    const otherWalker = walkerKey === "luis" ? "gabriela" : "luis";
    expect((await token(otherWalker, `walk:${walkId}`)).status).toBe(403);
  });

  test("chat room: non-participant → 403, participant → ticket", async () => {
    expect((await token("carlos", `chat:${bookingId}`)).status).toBe(403);
    expect((await token("ana", `chat:${bookingId}`)).status).toBe(200);
  });

  test("unknown room kinds and ids are rejected", async () => {
    expect((await token("ana", "admin:everything")).status).toBe(400);
    expect((await token("ana", "walk:nope")).status).toBe(404);
  });
});

describe("POST /api/messages publishes with the server-side identity", () => {
  const published: { room: string; event: string; data: Record<string, unknown> }[] = [];
  beforeAll(() => setRealtimePublisherForTests(async (room, event, data) => void published.push({ room, event, data })));
  afterAll(() => setRealtimePublisherForTests(null));

  test("spoofed fromId/fromName/role in the body are ignored", async () => {
    const r = await call(messages.POST as H, {
      method: "POST",
      cookie: cookies.ana,
      body: { threadId: bookingId, body: "hola", fromId: ids.admin, fromName: "Soporte", role: "ADMIN" },
    });
    expect(r.status).toBe(201);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      room: `chat:${bookingId}`,
      event: "chat:message",
      data: { id: r.json.id, fromId: ids.ana, role: "OWNER", body: "hola" },
    });
  });

  test("nothing is published when access is denied", async () => {
    const before = published.length;
    const r = await call(messages.POST as H, {
      method: "POST",
      cookie: cookies.carlos,
      body: { threadId: bookingId, body: "intruso" },
    });
    expect(r.status).toBe(403);
    expect(published.length).toBe(before);
  });
});

describe("live-service", () => {
  let server: LiveServer;
  let url: string;
  let internalUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    server = createLiveServer({ secret: DEV_REALTIME_SECRET, quiet: true });
    const ports = await server.listen(0, 0);
    url = `http://127.0.0.1:${ports.port}`;
    internalUrl = `http://127.0.0.1:${ports.internalPort}`;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await server.close();
  });

  function connect(auth: Record<string, unknown>): Promise<{ socket: Socket; error?: string }> {
    return new Promise((resolve) => {
      const socket = ioClient(url, { path: "/", transports: ["websocket"], auth, reconnection: false, forceNew: true });
      sockets.push(socket);
      socket.on("connect", () => resolve({ socket }));
      socket.on("connect_error", (e) => resolve({ socket, error: e.message }));
    });
  }

  async function connectAs(who: keyof typeof PHONES): Promise<Socket> {
    const { socket, error } = await connect({ token: (await token(who)).json.token });
    expect(error).toBeUndefined();
    return socket;
  }

  const emitAck = (s: Socket, event: string, payload: unknown) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => s.emit(event, payload, resolve));

  const nextEvent = <T>(s: Socket, event: string, ms = 1_500) =>
    new Promise<T | null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      s.once(event, (p: T) => {
        clearTimeout(t);
        resolve(p);
      });
    });

  test("handshake without a token, with a forged one, or an expired one is refused", async () => {
    expect((await connect({})).error).toBe("unauthorized");
    const forged = signToken({ typ: "conn", sub: ids.admin, name: "x", role: "ADMIN", exp: 9e9 }, "wrong-secret");
    expect((await connect({ token: forged })).error).toBe("unauthorized");
    const expired = signToken({ typ: "conn", sub: ids.ana, name: "x", role: "OWNER", exp: 1 }, DEV_REALTIME_SECRET);
    expect((await connect({ token: expired })).error).toBe("unauthorized");
    // A room ticket is not a connection token.
    const ticket = (await token("ana", `chat:${bookingId}`)).json.token;
    expect((await connect({ token: ticket })).error).toBe("unauthorized");
  });

  test("joining a room without a ticket, or with someone else's ticket, is refused", async () => {
    const carlos = await connectAs("carlos");
    expect(await emitAck(carlos, "chat:join", { threadId: bookingId })).toEqual({ ok: false, error: "forbidden" });
    const anasTicket = (await token("ana", `chat:${bookingId}`)).json.token;
    expect(await emitAck(carlos, "chat:join", { threadId: bookingId, ticket: anasTicket })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const anasWalkTicket = (await token("ana", `walk:${walkId}`)).json.token;
    expect(await emitAck(carlos, "walk:join", { walkId, ticket: anasWalkTicket })).toEqual({
      ok: false,
      error: "forbidden",
    });
    // Ticket for a different room.
    expect(await emitAck(carlos, "walk:join", { walkId: "other", ticket: anasWalkTicket })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  test("participants join; typing identity comes from the token; sockets cannot send messages", async () => {
    const ana = await connectAs("ana");
    const walker = await connectAs(walkerKey);
    for (const [s, who] of [[ana, "ana"], [walker, walkerKey]] as const) {
      const ticket = (await token(who, `chat:${bookingId}`)).json.token;
      expect(await emitAck(s, "chat:join", { threadId: bookingId, ticket })).toEqual({ ok: true });
    }
    const typing = nextEvent<{ userId: string; userName: string }>(walker, "chat:typing");
    ana.emit("chat:typing", { threadId: bookingId, userId: ids.admin, userName: "Soporte" });
    expect(await typing).toMatchObject({ userId: ids.ana });

    expect(await emitAck(ana, "chat:message", { threadId: bookingId, body: "x" })).toEqual({
      ok: false,
      error: "use_api",
    });
  });

  test("GPS points reach the walk room only through the track API", async () => {
    const live = await db.walk.findUniqueOrThrow({ where: { id: walkId } });
    const fresh = await db.walk.create({
      data: {
        bookingId: live.bookingId,
        walkerId: live.walkerId,
        ownerId: live.ownerId,
        dogId: live.dogId,
        zoneId: live.zoneId,
        status: "IN_PROGRESS",
        scheduledStart: new Date(),
        startedAt: new Date(Date.now() - 60_000),
        startLat: -17.7931,
        startLng: -63.1998,
      },
    });
    process.env.LIVE_SERVICE_INTERNAL_URL = internalUrl;
    try {
      const ana = await connectAs("ana");
      const ticket = (await token("ana", `walk:${fresh.id}`)).json.token;
      expect(await emitAck(ana, "walk:join", { walkId: fresh.id, ticket })).toEqual({ ok: true });
      const got = nextEvent<{ walkId: string; points: { seq: number }[]; distMeters: number }>(ana, "walk:points");
      const r = await call(track.POST as H, {
        method: "POST",
        cookie: cookies[walkerKey],
        params: { id: fresh.id },
        body: { points: [{ seq: 0, lat: -17.79315, lng: -63.19985, ts: Date.now() - 1_000, acc: 5 }] },
      });
      expect(r.status).toBe(200);
      expect(await got).toMatchObject({ walkId: fresh.id, points: [{ seq: 0 }] });
    } finally {
      delete process.env.LIVE_SERVICE_INTERNAL_URL;
      await db.walk.delete({ where: { id: fresh.id } });
    }
  });

  test("internal publish requires the internal token and reaches only the room", async () => {
    const ana = await connectAs("ana");
    const ticket = (await token("ana", `chat:${bookingId}`)).json.token;
    await emitAck(ana, "chat:join", { threadId: bookingId, ticket });
    const outsider = await connectAs("carlos");

    const body = JSON.stringify({ room: `chat:${bookingId}`, event: "chat:message", data: { id: "m1", body: "hi" } });
    const unauth = await fetch(`${internalUrl}/publish`, { method: "POST", body });
    expect(unauth.status).toBe(401);
    const userTok = (await token("ana")).json.token;
    const asUser = await fetch(`${internalUrl}/publish`, {
      method: "POST",
      body,
      headers: { Authorization: `Bearer ${userTok}` },
    });
    expect(asUser.status).toBe(401);

    const got = nextEvent<{ id: string }>(ana, "chat:message");
    const leaked = nextEvent(outsider, "chat:message", 500);
    const internal = signToken({ typ: "internal", exp: Math.floor(Date.now() / 1000) + 60 }, DEV_REALTIME_SECRET);
    const res = await fetch(`${internalUrl}/publish`, {
      method: "POST",
      body,
      headers: { Authorization: `Bearer ${internal}` },
    });
    expect(res.status).toBe(202);
    expect(await got).toMatchObject({ id: "m1" });
    expect(await leaked).toBeNull();
  });

  test("API publisher → live-service → room, end to end", async () => {
    process.env.LIVE_SERVICE_INTERNAL_URL = internalUrl;
    try {
      const walker = await connectAs(walkerKey);
      const ticket = (await token(walkerKey, `chat:${bookingId}`)).json.token;
      await emitAck(walker, "chat:join", { threadId: bookingId, ticket });
      const got = nextEvent<{ fromId: string; body: string }>(walker, "chat:message");
      const r = await call(messages.POST as H, {
        method: "POST",
        cookie: cookies.ana,
        body: { threadId: bookingId, body: "¿Cómo va Max?" },
      });
      expect(r.status).toBe(201);
      expect(await got).toMatchObject({ fromId: ids.ana, body: "¿Cómo va Max?" });
    } finally {
      delete process.env.LIVE_SERVICE_INTERNAL_URL;
    }
  });
});
