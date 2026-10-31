"use client";

// Socket.io singleton for the live-service.
// Dev: through the gateway (NEVER hardcode ports: only the XTransformPort
// query param). Production: NEXT_PUBLIC_LIVE_URL when the service has its own host.
//
// Auth: the handshake carries a short-lived token from /api/realtime/token
// (fetched again on every reconnect); each room join carries a room ticket
// from the same endpoint. Joined rooms are re-joined after a reconnect.
// Chat messages are sent through the REST API, which publishes them.

import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import { useFiruSession } from "./session";

const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_URL;

let socket: Socket | null = null;
let socketUserId: string | null = null;

type JoinAck = { ok: true } | { ok: false; error: string };

/** Rooms this tab wants to be in → how to (re)join them. */
const joined = new Map<string, () => void>();

async function fetchToken(room?: string): Promise<string> {
  const res = await api.post<{ token: string }>("/api/realtime/token", room ? { room } : {});
  return res.token;
}

export function getSocket(): Socket {
  const userId = useFiruSession.getState().user?.id ?? null;
  if (socket && socketUserId !== userId) resetSocket();
  if (!socket) {
    socketUserId = userId;
    socket = io(LIVE_URL || "/?XTransformPort=3003", {
      path: "/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      timeout: 8000,
      auth: (cb) => {
        fetchToken()
          .then((token) => cb({ token }))
          .catch(() => cb({}));
      },
    });
    socket.on("connect", () => {
      for (const rejoin of joined.values()) rejoin();
    });
  }
  return socket;
}

/** Drop the connection (logout / user switch); the next getSocket() reconnects. */
export function resetSocket() {
  socket?.disconnect();
  socket = null;
  socketUserId = null;
  joined.clear();
}

// A different user (or none) must never keep the previous user's socket.
useFiruSession.subscribe((s) => {
  if (socket && (s.user?.id ?? null) !== socketUserId) resetSocket();
});

/** Fetch a ticket for `room` and emit `event`; logs (dev) when refused. */
function joinRoom(room: string, event: string, payload: Record<string, unknown>) {
  const join = () => {
    const s = getSocket();
    fetchToken(room)
      .then((ticket) => {
        if (!joined.has(room)) return; // left while fetching
        s.emit(event, { ...payload, ticket }, (ack: JoinAck) => {
          if (!ack?.ok && process.env.NODE_ENV !== "production") {
            console.warn(`[live] ${event} refused`, ack);
          }
        });
      })
      .catch(() => undefined);
  };
  joined.set(room, join);
  // On a fresh socket the "connect" handler joins; otherwise join now.
  if (getSocket().connected) join();
}

/** `walk:points` — GPS fixes the server accepted (POST /api/walks/[id]/track). */
export interface WalkPointsEvent {
  walkId: string;
  points: { seq: number; lat: number; lng: number; ts: number }[];
  distMeters: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  fromId: string;
  fromName: string;
  role: "OWNER" | "WALKER" | "ADMIN";
  body: string;
  ts: number;
}

/** Join a live-walk room (owner, assigned walker or admin). */
export function joinLiveWalk(walkId: string) {
  joinRoom(`walk:${walkId}`, "walk:join", { walkId });
}

export function leaveLiveWalk(walkId: string) {
  joined.delete(`walk:${walkId}`);
  socket?.emit("walk:leave", { walkId });
}

export function joinChat(threadId: string) {
  joinRoom(`chat:${threadId}`, "chat:join", { threadId });
}

export function leaveChat(threadId: string) {
  joined.delete(`chat:${threadId}`);
  socket?.emit("chat:leave", { threadId });
}

export function sendTyping(threadId: string) {
  socket?.emit("chat:typing", { threadId });
}
