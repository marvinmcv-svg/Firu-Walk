// index.ts — FiruWalk live-service entry.
//
// Socket.io server on port 3003, path "/" (MANDATORY for the Caddy gateway:
// the frontend connects via io("/?XTransformPort=3003")).
//
// Two features, zero database, zero HTTP API:
//   1. Live walk GPS simulation  — rooms `walk:{walkId}` (see sim.ts)
//   2. Stateless chat relay      — rooms `chat:{threadId}` (history comes
//      from the REST API `/api/messages?threadId=`; this service stores nothing)
//
// Event contract — must match src/lib/firu/socket.ts EXACTLY:
//   Client → Server:
//     walk:join    { walkId, status, startLat?, startLng? }
//     walk:stop    { walkId }
//     walk:leave   { walkId }
//     chat:join    { threadId, userId, userName, role }
//     chat:message { threadId, fromId, fromName, role, body }
//     chat:leave   { threadId }
//     chat:typing  { threadId, userId, userName }
//   Server → Client:
//     walk:state   { walkId, points: LivePoint[], distMeters }
//     walk:point   { walkId, seq, lat, lng, ts, distMeters }
//     walk:ended   { walkId }
//     chat:joined  { threadId, memberCount }        (to the joining socket)
//     chat:message { id, threadId, fromId, fromName, role, body, ts }
//     chat:typing  { threadId, userId, userName }   (everyone except sender)

import { createServer } from "http";
import { Server } from "socket.io";
import { WalkSim, type LivePoint } from "./sim";

const PORT = 3003;

const ROOM_WALK = (walkId: string) => `walk:${walkId}`;
const ROOM_CHAT = (threadId: string) => `chat:${threadId}`;

/** Keep ended sims (with their point history) for late rejoiners. */
const KEEP_ENDED_MS = 5 * 60 * 1_000;
/** Stop running sims that have had zero connected clients this long. */
const IDLE_STOP_MS = 10 * 60 * 1_000;
/** Housekeeping sweep cadence. */
const HOUSEKEEPING_MS = 30 * 1_000;

/** Max accepted chat body length. */
const CHAT_BODY_MAX = 1_000;

interface SimEntry {
  sim: WalkSim;
  /** Timestamp when the sim finished (stop or 720-point budget), else null. */
  endedAt: number | null;
  /** When the walk room last became empty while the sim was running. */
  emptySince: number | null;
}

const sims = new Map<string, SimEntry>();

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — Caddy forwards "/?XTransformPort=3003" here.
  path: "/",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

/* ------------------------------------------------------------------ utils */

const short = (id: string): string => (id.length > 8 ? id.slice(0, 8) : id);

const ts = (): string => new Date().toISOString().slice(11, 23);

const log = (scope: string, msg: string): void =>
  console.log(`[live ${ts()}] ${scope} ${msg}`);

const roomSize = (room: string): number =>
  io.sockets.adapter.rooms.get(room)?.size ?? 0;

/** Narrow an unknown socket payload into a record. */
function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : null;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/* ------------------------------------------------------------------- walk */

function emitWalkState(walkId: string, entry: SimEntry): void {
  const payload: {
    walkId: string;
    points: LivePoint[];
    distMeters: number;
  } = {
    walkId,
    points: entry.sim.points,
    distMeters: entry.sim.distanceMeters,
  };
  io.to(ROOM_WALK(walkId)).emit("walk:state", payload);
}

function startWalkSim(
  walkId: string,
  startLat: number | undefined,
  startLng: number | undefined,
): SimEntry {
  const sim = new WalkSim({
    walkId,
    startLat,
    startLng,
    onPoint: (point) => {
      io.to(ROOM_WALK(walkId)).emit("walk:point", { walkId, ...point });
    },
    onEnd: (reason) => {
      io.to(ROOM_WALK(walkId)).emit("walk:ended", { walkId });
      const e = sims.get(walkId);
      if (e) e.endedAt = Date.now();
      log(
        `[walk:${short(walkId)}]`,
        `sim ended (${reason}) — ${sim.points.length} pts, ${Math.round(
          sim.distanceMeters,
        )} m`,
      );
    },
  });
  const entry: SimEntry = { sim, endedAt: null, emptySince: null };
  sims.set(walkId, entry);

  // First event for the room: current (empty) state, then a point per tick.
  io.to(ROOM_WALK(walkId)).emit("walk:state", {
    walkId,
    points: sim.points,
    distMeters: sim.distanceMeters,
  });
  sim.start();

  log(
    `[walk:${short(walkId)}]`,
    `sim started at (${sim.origin.lat.toFixed(5)}, ${sim.origin.lng.toFixed(
      5,
    )}) — 1 pt / 2.5 s, cap 720`,
  );
  return entry;
}

/* ------------------------------------------------------------------- chat */

/* ------------------------------------------------------------ housekeeping */

const housekeeper = setInterval(() => {
  const now = Date.now();
  for (const [walkId, entry] of sims) {
    if (entry.endedAt !== null) {
      // Ended sims are kept for late rejoiners, then discarded after 5 min.
      if (now - entry.endedAt >= KEEP_ENDED_MS) {
        sims.delete(walkId);
        log(
          `[walk:${short(walkId)}]`,
          `cleanup: ended sim discarded (${entry.sim.points.length} pts)`,
        );
      }
      continue;
    }
    if (roomSize(ROOM_WALK(walkId)) === 0) {
      // Running sim with nobody watching: allow up to 10 min for rejoin.
      if (entry.emptySince === null) entry.emptySince = now;
      if (now - entry.emptySince >= IDLE_STOP_MS) {
        entry.sim.stop("idle");
        sims.delete(walkId);
        log(`[walk:${short(walkId)}]`, `cleanup: stopped idle sim (no clients for 10 min)`);
      }
    } else {
      entry.emptySince = null;
    }
  }
}, HOUSEKEEPING_MS);

/* ------------------------------------------------------------------- wiring */

io.on("connection", (socket) => {
  log("[conn]", `connected ${socket.id} (total ${io.engine.clientsCount})`);

  /* -------- live walk -------- */

  socket.on("walk:join", (raw: unknown) => {
    const p = asRecord(raw);
    if (!p) return;
    const walkId = asString(p.walkId);
    if (!walkId) return;
    const status = asString(p.status) ?? "";
    const startLat = asNumber(p.startLat) ?? undefined;
    const startLng = asNumber(p.startLng) ?? undefined;

    const room = ROOM_WALK(walkId);
    socket.join(room);

    const existing = sims.get(walkId);
    if (existing) {
      // Rejoin (or another viewer): resync the room with the full history.
      emitWalkState(walkId, existing);
      if (existing.endedAt !== null) {
        // Simulation already finished — let the late joiner know.
        socket.emit("walk:ended", { walkId });
      } else {
        existing.emptySince = null; // someone is watching again
      }
      log(
        `[walk:${short(walkId)}]`,
        `join (rejoin, ${existing.sim.points.length} pts buffered, status=${status}, room=${roomSize(room)})`,
      );
      return;
    }

    if (status !== "IN_PROGRESS") {
      // Nothing live to simulate — the room stays joined (e.g. SCHEDULED walk);
      // the frontend renders history via REST.
      log(`[walk:${short(walkId)}]`, `join (status=${status}, no sim)`);
      return;
    }

    startWalkSim(walkId, startLat, startLng);
    log(`[walk:${short(walkId)}]`, `join (status=IN_PROGRESS, room=${roomSize(room)})`);
  });

  socket.on("walk:stop", (raw: unknown) => {
    const p = asRecord(raw);
    const walkId = p ? asString(p.walkId) : null;
    if (!walkId) return;
    const entry = sims.get(walkId);
    if (!entry) return;
    if (entry.endedAt === null) {
      // stop() fires onEnd → emits walk:ended to the room and stamps endedAt
      // (history stays available for 5 min for late rejoiners).
      entry.sim.stop("stopped");
    }
    log(`[walk:${short(walkId)}]`, `stop requested by ${socket.id}`);
  });

  socket.on("walk:leave", (raw: unknown) => {
    const p = asRecord(raw);
    const walkId = p ? asString(p.walkId) : null;
    if (!walkId) return;
    socket.leave(ROOM_WALK(walkId));
    log(
      `[walk:${short(walkId)}]`,
      `leave (${socket.id}, room=${roomSize(ROOM_WALK(walkId))})`,
    );
  });

  /* -------- chat relay (stateless) -------- */

  socket.on("chat:join", (raw: unknown) => {
    const p = asRecord(raw);
    if (!p) return;
    const threadId = asString(p.threadId);
    if (!threadId) return;
    const userId = asString(p.userId) ?? "";
    const userName = asString(p.userName) ?? "?";

    socket.join(ROOM_CHAT(threadId));
    const memberCount = roomSize(ROOM_CHAT(threadId));
    // History is NOT stored here — the frontend fetches it via
    // REST /api/messages?threadId=…; we only confirm the room membership.
    socket.emit("chat:joined", { threadId, memberCount });
    log(
      `[chat:${short(threadId)}]`,
      `join ${userName} (${userId}) — members=${memberCount}`,
    );
  });

  socket.on("chat:message", (raw: unknown) => {
    const p = asRecord(raw);
    if (!p) return;
    const threadId = asString(p.threadId);
    const body = typeof p.body === "string" ? p.body.trim() : "";
    if (!threadId) return;

    // Validate: non-empty string, at most 1000 chars.
    if (body.length === 0 || body.length > CHAT_BODY_MAX) {
      log(
        `[chat:${short(threadId)}]`,
        `invalid message rejected (len=${body.length})`,
      );
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      threadId,
      fromId: asString(p.fromId) ?? "",
      fromName: asString(p.fromName) ?? "?",
      role: asString(p.role) ?? "OWNER",
      body,
      ts: Date.now(),
    };
    // Broadcast to the whole room INCLUDING the sender (frontend dedupes by id).
    io.to(ROOM_CHAT(threadId)).emit("chat:message", message);
  });

  socket.on("chat:typing", (raw: unknown) => {
    const p = asRecord(raw);
    const threadId = p ? asString(p.threadId) : null;
    if (!threadId) return;
    // Everyone in the room EXCEPT the sender ("escribiendo…").
    socket.to(ROOM_CHAT(threadId)).emit("chat:typing", {
      threadId,
      userId: asString(p?.userId) ?? "",
      userName: asString(p?.userName) ?? "Alguien",
    });
  });

  socket.on("chat:leave", (raw: unknown) => {
    const p = asRecord(raw);
    const threadId = p ? asString(p.threadId) : null;
    if (!threadId) return;
    socket.leave(ROOM_CHAT(threadId));
    log(`[chat:${short(threadId)}]`, `leave (${socket.id})`);
  });

  /* -------- lifecycle -------- */

  socket.on("disconnect", (reason) => {
    log("[conn]", `disconnected ${socket.id} (${reason}, total ${io.engine.clientsCount})`);
  });

  socket.on("error", (err: Error) => {
    log("[conn]", `socket error ${socket.id}: ${err.message}`);
  });
});

/* ---------------------------------------------------------- start/shutdown */

httpServer.listen(PORT, () => {
  log("[live]", `FiruWalk live-service listening on :${PORT} (socket.io path "/")`);
});

function shutdown(signal: string): void {
  log("[live]", `received ${signal} — shutting down`);
  clearInterval(housekeeper);
  for (const [walkId, entry] of sims) {
    entry.sim.stop("shutdown"); // emits a final walk:ended to any rooms left
  }
  sims.clear();
  io.close(() => {
    httpServer.close(() => {
      log("[live]", "server closed");
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
