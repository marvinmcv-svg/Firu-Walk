// GET  /api/messages?threadId= → Message[] (booking participants only)
//      (no threadId → latest messages across the user's threads, for the inbox)
// POST /api/messages {threadId, body} → Message (persisted; live relay is the
//      socket service's job — the frontend broadcasts via chat:join rooms)

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, reqStr, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** threadId === bookingId. Participants: booking owner, assigned walker, admin. */
async function assertParticipant(threadId: string, userId: string, role: string) {
  const booking = await db.booking.findUnique({ where: { id: threadId } });
  if (!booking) throw new ApiError(404, "La conversación no existe.");
  const isParticipant =
    role === "ADMIN" || booking.ownerId === userId || booking.walkerId === userId;
  if (!isParticipant) throw new ApiError(403, "No tienes acceso a esta conversación.");
  return booking;
}

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const threadId = new URL(req.url).searchParams.get("threadId");

    if (threadId) {
      await assertParticipant(threadId, user.id, user.role);
      const messages = await db.message.findMany({
        where: { threadId },
        orderBy: { createdAt: "asc" },
        take: 300,
      });
      return ok(messages);
    }

    // Inbox feed: messages across my bookings, newest first
    const bookings = await db.booking.findMany({
      where:
        user.role === "ADMIN"
          ? {}
          : user.role === "WALKER"
            ? { walkerId: user.id }
            : { ownerId: user.id },
      select: { id: true },
    });
    const messages = await db.message.findMany({
      where: { threadId: { in: bookings.map((b) => b.id) } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok(messages);
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const body = await readJson(req);
    const threadId = optStr(body, "threadId");
    if (!threadId) throw new ApiError(400, "La conversación es obligatoria.");
    await assertParticipant(threadId, user.id, user.role);

    const text = reqStr(body, "body", "El mensaje", { max: 1000 });
    const message = await db.message.create({
      data: {
        threadId,
        senderId: user.id,
        senderName: user.name,
        body: text,
      },
    });
    return ok(message, { status: 201 });
  });
}
