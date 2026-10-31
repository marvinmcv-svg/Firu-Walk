// Realtime (live-service) integration: short-lived HS256 tokens for the
// socket handshake and room joins, room access checks, and server-side
// publishing of events (chat messages, GPS points, walk ended) over the live-service's
// internal port. Token format must match mini-services/live-service/token.ts.

import { createHmac } from "node:crypto";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "./http";
import { log } from "./log";

/** Development fallback — must match mini-services/live-service/token.ts. */
const DEV_REALTIME_SECRET = "firuwalk-dev-only-realtime-secret-do-not-use";

export const CONN_TOKEN_TTL_S = 10 * 60;
export const ROOM_TICKET_TTL_S = 2 * 60;
const INTERNAL_TOKEN_TTL_S = 60;
const PUBLISH_TIMEOUT_MS = 3_000;

export type RoomCap = "view" | "walker" | "admin";

function secret(): string {
  const s = process.env.REALTIME_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REALTIME_SECRET is not configured");
  }
  return DEV_REALTIME_SECRET;
}

function sign(claims: Record<string, unknown>, ttlS: number): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({
    ...claims,
    exp: Math.floor(Date.now() / 1_000) + ttlS,
  })}`;
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}

/** Handshake token: identity only (who), checked once per connection. */
export function connToken(user: { id: string; name: string; role: Role }): string {
  return sign({ typ: "conn", sub: user.id, name: user.name, role: user.role }, CONN_TOKEN_TTL_S);
}

/** Room ticket: permission for `user` to join `room`, issued after an access check. */
export function roomTicket(userId: string, room: string, cap: RoomCap, walkStatus?: string): string {
  return sign({ typ: "room", sub: userId, room, cap, ...(walkStatus ? { st: walkStatus } : {}) }, ROOM_TICKET_TTL_S);
}

/* ------------------------------------------------------------- access */

/** threadId === bookingId. Participants: booking owner, assigned walker, admin. */
export async function assertThreadParticipant(threadId: string, userId: string, role: Role) {
  const booking = await db.booking.findUnique({ where: { id: threadId } });
  if (!booking) throw new ApiError(404, "La conversación no existe.");
  const isParticipant =
    role === "ADMIN" || booking.ownerId === userId || booking.walkerId === userId;
  if (!isParticipant) throw new ApiError(403, "No tienes acceso a esta conversación.");
  return booking;
}

/** Walk viewers: the dog's owner, the assigned walker, admins. */
export async function walkRoomAccess(walkId: string, userId: string, role: Role) {
  const walk = await db.walk.findUnique({
    where: { id: walkId },
    select: { ownerId: true, walkerId: true, status: true },
  });
  if (!walk) throw new ApiError(404, "Paseo no encontrado.");
  const cap: RoomCap | null =
    walk.walkerId === userId ? "walker" : role === "ADMIN" ? "admin" : walk.ownerId === userId ? "view" : null;
  if (!cap) throw new ApiError(403, "No tienes acceso a este paseo.");
  return { cap, status: walk.status };
}

/* ------------------------------------------------------------ publish */

export type RealtimeEvent = "chat:message" | "walk:points" | "walk:ended";
type Publisher = (room: string, event: RealtimeEvent, data: Record<string, unknown>) => Promise<void>;

let override: Publisher | null = null;

/** Tests capture published events here. */
export function setRealtimePublisherForTests(p: Publisher | null): void {
  override = p;
}

/**
 * Push an event to everyone in `room` via the live-service internal API
 * (LIVE_SERVICE_INTERNAL_URL). Best effort: never throws — the data is
 * already persisted and clients refetch on reconnect.
 */
export async function publishRealtime(
  room: string,
  event: RealtimeEvent,
  data: Record<string, unknown>
): Promise<void> {
  if (override) return override(room, event, data);
  const base = process.env.LIVE_SERVICE_INTERNAL_URL;
  if (!base) return;
  try {
    const res = await fetch(new URL("/publish", base), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sign({ typ: "internal" }, INTERNAL_TOKEN_TTL_S)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ room, event, data }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    if (!res.ok) log.warn("realtime.publish_failed", { room, event, status: res.status });
  } catch (err) {
    log.warn("realtime.publish_failed", { room, event, err });
  }
}
