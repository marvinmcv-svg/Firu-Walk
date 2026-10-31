// GET   /api/notifications/preferences → NotificationPrefsDTO
// PATCH /api/notifications/preferences {whatsapp?, push?, locale?} → NotificationPrefsDTO
// In-app notifications are always on; WhatsApp and web push can be switched
// off. `locale` (es | en) picks the language of templates and push texts.

import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getPrefs } from "@/lib/server/notifications/notifier";
import { getWhatsAppSender, pushPublicKey } from "@/lib/server/notifications/channels";
import type { NotificationPrefsDTO } from "@/lib/firu/types";

const Body = z
  .object({
    whatsapp: z.boolean().optional(),
    push: z.boolean().optional(),
    locale: z.enum(["es", "en"], { message: "Idioma inválido." }).optional(),
  })
  .strict();

async function prefsDTO(userId: string): Promise<NotificationPrefsDTO> {
  const [prefs, devices] = await Promise.all([
    getPrefs(userId),
    db.pushSubscription.count({ where: { userId } }),
  ]);
  return {
    ...prefs,
    whatsappAvailable: getWhatsAppSender() !== null,
    pushPublicKey: pushPublicKey(),
    pushDevices: devices,
  };
}

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    return ok(await prefsDTO(user.id));
  });
}

export async function PATCH(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const data = parsed.data;
    if (Object.keys(data).length === 0) throw new ApiError(400, "Nada que actualizar.");
    await db.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return ok(await prefsDTO(user.id));
  });
}
