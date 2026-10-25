// Notification service — every state change notifies the affected party
// (Spanish, friendly, emojis like the seeded style).

import { db } from "@/lib/db";

export async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  link?: string | null
): Promise<void> {
  await db.notification.create({
    data: { userId, type, title, body, link: link ?? null },
  });
}

/** Notify every ADMIN user (used for applications, payout requests, disputes). */
export async function notifyAdmins(
  type: string,
  title: string,
  body: string,
  link?: string | null
): Promise<void> {
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  for (const a of admins) {
    await notify(a.id, type, title, body, link);
  }
}
