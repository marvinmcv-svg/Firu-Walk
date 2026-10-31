// POST /api/realtime/token            → { token, expiresIn }  socket handshake (identity)
// POST /api/realtime/token {room}     → { token, expiresIn }  ticket to join one room:
//   walk:{walkId}   dog owner, assigned walker, admin
//   chat:{threadId} booking participants (threadId === bookingId)

import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import {
  CONN_TOKEN_TTL_S,
  ROOM_TICKET_TTL_S,
  assertThreadParticipant,
  connToken,
  roomTicket,
  walkRoomAccess,
} from "@/lib/server/realtime";

const ROOM_RE = /^(walk|chat):([A-Za-z0-9_-]{1,64})$/;

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const room = optStr(await readJson(req), "room");

    if (!room) {
      return ok({ token: connToken(user), expiresIn: CONN_TOKEN_TTL_S });
    }

    const m = ROOM_RE.exec(room);
    if (!m) throw new ApiError(400, "Sala inválida.");
    const [, kind, id] = m;

    if (kind === "walk") {
      const { cap, status } = await walkRoomAccess(id, user.id, user.role);
      return ok({ token: roomTicket(user.id, room, cap, status), expiresIn: ROOM_TICKET_TTL_S });
    }
    await assertThreadParticipant(id, user.id, user.role);
    const cap = user.role === "ADMIN" ? "admin" : "view";
    return ok({ token: roomTicket(user.id, room, cap), expiresIn: ROOM_TICKET_TTL_S });
  });
}
