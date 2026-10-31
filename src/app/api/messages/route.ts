// GET  /api/messages?threadId= → Message[] (booking participants only)
//      (no threadId → latest messages across the user's threads, for the inbox)
// POST /api/messages {threadId, body} → Message (persisted, then published to
//      the `chat:{threadId}` room with the sender's identity from the session).
//      Messages that share a phone number or a WhatsApp link are delivered
//      but flagged (contactFlag); the chat shows a gentle "keep it in
//      FiruWalk" reminder. Never blocked.

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, reqStr, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { assertThreadParticipant as assertParticipant, publishRealtime } from "@/lib/server/realtime";
import { containsContactInfo } from "@/lib/firu/contactGuard";
import { log } from "@/lib/server/log";

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
    const contactFlag = user.role !== "ADMIN" && containsContactInfo(text);
    const message = await db.message.create({
      data: {
        threadId,
        senderId: user.id,
        senderName: user.name,
        body: text,
        contactFlag,
      },
    });
    if (contactFlag) log.info("chat.contact_shared", { threadId, senderId: user.id, messageId: message.id });
    await publishRealtime(`chat:${threadId}`, "chat:message", {
      id: message.id,
      threadId,
      fromId: user.id,
      fromName: user.name,
      role: user.role,
      body: message.body,
      contactFlag,
      ts: message.createdAt.getTime(),
    });
    return ok(message, { status: 201 });
  });
}
