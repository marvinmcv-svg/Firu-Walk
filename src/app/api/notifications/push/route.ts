// POST   /api/notifications/push {endpoint, keys:{p256dh, auth}} → {ok, devices}
//        Saves this browser's Web Push subscription for the signed-in user.
// DELETE /api/notifications/push {endpoint} → {ok, devices}
//        Removes it (only the caller's own subscriptions).

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

const MAX_DEVICES = 10;

const Endpoint = z
  .string()
  .url("Suscripción inválida.")
  .max(1000)
  .refine((u) => u.startsWith("https://"), "Suscripción inválida.");

const Subscribe = z.object({
  endpoint: Endpoint,
  keys: z.object({
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }),
});

const Unsubscribe = z.object({ endpoint: Endpoint });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(400, r.error.issues[0]?.message ?? "Suscripción inválida.");
  return r.data;
}

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const { endpoint, keys } = parse(Subscribe, await readJson(req));
    // The same browser may have been registered by someone who signed out:
    // the endpoint now belongs to whoever is signed in.
    await db.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
      },
      update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
    });
    // Keep the newest devices only.
    const all = await db.pushSubscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (all.length > MAX_DEVICES) {
      await db.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_DEVICES).map((s) => s.id) } } });
    }
    return ok({ ok: true, devices: Math.min(all.length, MAX_DEVICES) }, { status: 201 });
  });
}

export async function DELETE(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const { endpoint } = parse(Unsubscribe, await readJson(req));
    await db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    const devices = await db.pushSubscription.count({ where: { userId: user.id } });
    return ok({ ok: true, devices });
  });
}
