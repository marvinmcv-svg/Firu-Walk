// server.ts — FiruWalk live-service (socket.io), as a factory so tests can
// start it on random ports. index.ts is the process entry.
//
// Security model (Milestone 3):
//   · Handshake requires a `conn` token from POST /api/realtime/token. The
//     user's id/name/role come from the token — never from event payloads.
//   · Joining `walk:{id}` / `chat:{id}` requires a `room` ticket for that exact
//     room, issued to the same user by the API after it checked access
//     (walk owner, assigned walker, booking participant or admin).
//   · Chat messages are NOT accepted from sockets: the API persists them
//     (POST /api/messages) and publishes them here over the internal port.
//   · The GPS simulator only runs when `simEnabled` (LIVE_SIM=true, dev).
//
// Event contract — must match src/lib/firu/socket.ts:
//   Client → Server (ack: { ok: true } | { ok: false, error }):
//     walk:join    { walkId, ticket, startLat?, startLng? }
//     walk:stop    { walkId }                 (assigned walker / admin, sim only)
//     walk:leave   { walkId }
//     chat:join    { threadId, ticket }
//     chat:typing  { threadId }
//     chat:leave   { threadId }
//   Server → Client:
//     walk:state   { walkId, points: LivePoint[], distMeters }
//     walk:point   { walkId, seq, lat, lng, ts, distMeters }
//     walk:ended   { walkId }
//     chat:joined  { threadId, memberCount }
//     chat:message { id, threadId, fromId, fromName, role, body, ts }
//     chat:typing  { threadId, userId, userName }   (everyone except sender)
//
// Internal HTTP (separate port, never exposed through the gateway):
//   POST /publish  Authorization: Bearer <internal token>  { room, event, data }
//   GET  /health

import { createServer, type IncomingMessage, type Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { WalkSim, type LivePoint } from "./sim";
import { verifyToken, type Cap, type ConnClaims, type RoomClaims } from "./token";

export interface LiveServerOptions {
  secret: string;
  simEnabled: boolean;
  redisUrl?: string;
  /** Extra CORS origins; "*" when empty (auth is token-based, no cookies). */
  corsOrigins?: string[];
  quiet?: boolean;
}

export interface LiveServer {
  io: Server;
  http: HttpServer;
  internal: HttpServer;
  listen(port: number, internalPort: number): Promise<{ port: number; internalPort: number }>;
  close(): Promise<void>;
}

interface SocketData {
  user: ConnClaims;
  /** room → capability granted by the ticket used to join it. */
  caps: Map<string, Cap>;
}

type LiveSocket = Socket<any, any, any, SocketData>;
type Ack = (res: { ok: true } | { ok: false; error: string }) => void;

const ROOM_WALK = (walkId: string) => `walk:${walkId}`;
const ROOM_CHAT = (threadId: string) => `chat:${threadId}`;
const ROOM_RE = /^(walk|chat):[A-Za-z0-9_-]{1,64}$/;

/** Events the API may publish into a room. */
const PUBLISHABLE = new Set(["chat:message", "walk:point", "walk:ended"]);

/** Keep ended sims (with their point history) for late rejoiners. */
const KEEP_ENDED_MS = 5 * 60 * 1_000;
/** Stop running sims that have had zero connected clients this long. */
const IDLE_STOP_MS = 10 * 60 * 1_000;
/** Housekeeping sweep cadence. */
const HOUSEKEEPING_MS = 30 * 1_000;
/** Max internal publish body. */
const PUBLISH_MAX_BYTES = 16 * 1_024;

interface SimEntry {
  sim: WalkSim;
  /** Timestamp when the sim finished (stop or 720-point budget), else null. */
  endedAt: number | null;
  /** When the walk room last became empty while the sim was running. */
  emptySince: number | null;
}

/* ------------------------------------------------------------------ utils */

const short = (id: string): string => (id.length > 8 ? id.slice(0, 8) : id);

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const reply = (ack: unknown, res: Parameters<Ack>[0]): void => {
  if (typeof ack === "function") (ack as Ack)(res);
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > PUBLISH_MAX_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ----------------------------------------------------------------- server */

export function createLiveServer(opts: LiveServerOptions): LiveServer {
  const log = (scope: string, msg: string): void => {
    if (opts.quiet) return;
    console.log(`[live ${new Date().toISOString().slice(11, 23)}] ${scope} ${msg}`);
  };

  const sims = new Map<string, SimEntry>();
  const http = createServer();
  const io = new Server<any, any, any, SocketData>(http, {
    // DO NOT change the path — the gateway forwards "/?XTransformPort=3003" here.
    path: "/",
    cors: { origin: opts.corsOrigins?.length ? opts.corsOrigins : "*", methods: ["GET", "POST"] },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  let redis: Redis | null = null;
  if (opts.redisUrl) {
    // Multi-instance: rooms and broadcasts fan out through Redis.
    redis = new Redis(opts.redisUrl, { maxRetriesPerRequest: 3 });
    const sub = redis.duplicate();
    io.adapter(createAdapter(redis, sub));
    io.of("/").adapter.on("error", (err: Error) => log("[redis]", err.message));
  }

  const roomSize = (room: string): number => io.sockets.adapter.rooms.get(room)?.size ?? 0;

  /* ---------------------------------------------------------- walk sim */

  function emitWalkState(walkId: string, entry: SimEntry): void {
    io.to(ROOM_WALK(walkId)).emit("walk:state", {
      walkId,
      points: entry.sim.points,
      distMeters: entry.sim.distanceMeters,
    });
  }

  function startWalkSim(walkId: string, startLat?: number, startLng?: number): SimEntry {
    const sim = new WalkSim({
      walkId,
      startLat,
      startLng,
      onPoint: (point: LivePoint) => {
        io.to(ROOM_WALK(walkId)).emit("walk:point", { walkId, ...point });
      },
      onEnd: (reason) => {
        io.to(ROOM_WALK(walkId)).emit("walk:ended", { walkId });
        const e = sims.get(walkId);
        if (e) e.endedAt = Date.now();
        log(`[walk:${short(walkId)}]`, `sim ended (${reason}) — ${sim.points.length} pts`);
      },
    });
    const entry: SimEntry = { sim, endedAt: null, emptySince: null };
    sims.set(walkId, entry);
    emitWalkState(walkId, entry);
    sim.start();
    log(`[walk:${short(walkId)}]`, "sim started");
    return entry;
  }

  const housekeeper = setInterval(() => {
    const now = Date.now();
    for (const [walkId, entry] of sims) {
      if (entry.endedAt !== null) {
        if (now - entry.endedAt >= KEEP_ENDED_MS) sims.delete(walkId);
        continue;
      }
      if (roomSize(ROOM_WALK(walkId)) === 0) {
        if (entry.emptySince === null) entry.emptySince = now;
        if (now - entry.emptySince >= IDLE_STOP_MS) {
          entry.sim.stop("idle");
          sims.delete(walkId);
        }
      } else {
        entry.emptySince = null;
      }
    }
  }, HOUSEKEEPING_MS);

  /* --------------------------------------------------------- handshake */

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token, opts.secret, "conn");
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    socket.data.caps = new Map();
    next();
  });

  /** Validate a room ticket: right room, issued to this socket's user, not expired. */
  function admit(socket: LiveSocket, room: string, ticket: unknown): RoomClaims | null {
    const claims = verifyToken(ticket, opts.secret, "room");
    if (!claims || claims.room !== room || claims.sub !== socket.data.user.sub) return null;
    return claims;
  }

  io.on("connection", (socket: LiveSocket) => {
    const me = socket.data.user;
    log("[conn]", `${socket.id} user=${short(me.sub)} role=${me.role}`);

    /* -------- live walk -------- */

    socket.on("walk:join", (raw: unknown, ack?: unknown) => {
      const p = asRecord(raw);
      const walkId = p ? asString(p.walkId) : null;
      if (!p || !walkId) return reply(ack, { ok: false, error: "bad_request" });
      const room = ROOM_WALK(walkId);
      const ticket = admit(socket, room, p.ticket);
      if (!ticket) {
        log(`[walk:${short(walkId)}]`, `join refused for ${short(me.sub)}`);
        return reply(ack, { ok: false, error: "forbidden" });
      }
      socket.data.caps.set(room, ticket.cap);
      socket.join(room);
      reply(ack, { ok: true });

      const existing = sims.get(walkId);
      if (existing) {
        emitWalkState(walkId, existing);
        if (existing.endedAt !== null) socket.emit("walk:ended", { walkId });
        else existing.emptySince = null;
        return;
      }
      // Status comes from the ticket (server truth), not from the client.
      if (opts.simEnabled && ticket.st === "IN_PROGRESS") {
        startWalkSim(walkId, asNumber(p.startLat) ?? undefined, asNumber(p.startLng) ?? undefined);
      }
    });

    socket.on("walk:stop", (raw: unknown, ack?: unknown) => {
      const p = asRecord(raw);
      const walkId = p ? asString(p.walkId) : null;
      if (!walkId) return reply(ack, { ok: false, error: "bad_request" });
      const cap = socket.data.caps.get(ROOM_WALK(walkId));
      if (cap !== "walker" && cap !== "admin") return reply(ack, { ok: false, error: "forbidden" });
      const entry = sims.get(walkId);
      if (entry && entry.endedAt === null) entry.sim.stop("stopped");
      reply(ack, { ok: true });
    });

    socket.on("walk:leave", (raw: unknown) => {
      const p = asRecord(raw);
      const walkId = p ? asString(p.walkId) : null;
      if (!walkId) return;
      socket.leave(ROOM_WALK(walkId));
      socket.data.caps.delete(ROOM_WALK(walkId));
    });

    /* -------- chat -------- */

    socket.on("chat:join", (raw: unknown, ack?: unknown) => {
      const p = asRecord(raw);
      const threadId = p ? asString(p.threadId) : null;
      if (!p || !threadId) return reply(ack, { ok: false, error: "bad_request" });
      const room = ROOM_CHAT(threadId);
      const ticket = admit(socket, room, p.ticket);
      if (!ticket) {
        log(`[chat:${short(threadId)}]`, `join refused for ${short(me.sub)}`);
        return reply(ack, { ok: false, error: "forbidden" });
      }
      socket.data.caps.set(room, ticket.cap);
      socket.join(room);
      reply(ack, { ok: true });
      socket.emit("chat:joined", { threadId, memberCount: roomSize(room) });
    });

    socket.on("chat:message", (_raw: unknown, ack?: unknown) => {
      // Messages are persisted and published by the API (POST /api/messages).
      reply(ack, { ok: false, error: "use_api" });
    });

    socket.on("chat:typing", (raw: unknown) => {
      const p = asRecord(raw);
      const threadId = p ? asString(p.threadId) : null;
      if (!threadId || !socket.rooms.has(ROOM_CHAT(threadId))) return;
      socket.to(ROOM_CHAT(threadId)).emit("chat:typing", {
        threadId,
        userId: me.sub,
        userName: me.name,
      });
    });

    socket.on("chat:leave", (raw: unknown) => {
      const p = asRecord(raw);
      const threadId = p ? asString(p.threadId) : null;
      if (!threadId) return;
      socket.leave(ROOM_CHAT(threadId));
      socket.data.caps.delete(ROOM_CHAT(threadId));
    });

    socket.on("disconnect", (reason) => log("[conn]", `${socket.id} disconnected (${reason})`));
  });

  /* ------------------------------------------------------ internal API */

  function publish(room: string, event: string, data: Record<string, unknown>): void {
    if (event === "walk:ended" && room.startsWith("walk:")) {
      const entry = sims.get(room.slice(5));
      // A running sim emits walk:ended itself when stopped.
      if (entry && entry.endedAt === null) return entry.sim.stop("stopped");
    }
    io.to(room).emit(event, data);
  }

  const internal = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
    if (req.method !== "POST" || req.url !== "/publish") return send(404, { error: "not_found" });

    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!verifyToken(token, opts.secret, "internal")) return send(401, { error: "unauthorized" });

    let body: Record<string, unknown> | null;
    try {
      body = asRecord(JSON.parse(await readBody(req)));
    } catch {
      return send(400, { error: "bad_request" });
    }
    const room = body ? asString(body.room) : null;
    const event = body ? asString(body.event) : null;
    const data = body ? asRecord(body.data) : null;
    if (!room || !ROOM_RE.test(room) || !event || !PUBLISHABLE.has(event) || !data) {
      return send(400, { error: "bad_request" });
    }
    publish(room, event, data);
    send(202, { ok: true });
  });

  return {
    io,
    http,
    internal,
    listen(port, internalPort) {
      const listenOn = (srv: HttpServer, p: number) =>
        new Promise<number>((resolve) => {
          srv.listen(p, () => {
            const addr = srv.address();
            resolve(typeof addr === "object" && addr ? addr.port : p);
          });
        });
      return Promise.all([listenOn(http, port), listenOn(internal, internalPort)]).then(
        ([a, b]) => ({ port: a, internalPort: b }),
      );
    },
    async close() {
      clearInterval(housekeeper);
      for (const entry of sims.values()) entry.sim.stop("shutdown");
      sims.clear();
      await new Promise<void>((r) => io.close(() => r()));
      await new Promise<void>((r) => internal.close(() => r()));
      if (redis) redis.disconnect();
    },
  };
}
