// POST /api/walkers/apply — PUBLIC application form.
// Creates User(role WALKER) + WalkerProfile(status PENDING) + default availability.
// The phone becomes the login (the applicant signs in later with a login code).
// Returns {applied:true}; it never opens a session.

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, reqNum, reqStr, run } from "@/lib/server/http";
import { getAppConfig } from "@/lib/server/config";
import { notify, notifyAdmins } from "@/lib/server/notify";
import { requirePhone } from "@/lib/server/auth/phone";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { clientIp } from "@/lib/server/request";

export async function POST(req: Request) {
  return run(async () => {
    await enforceRateLimit(`apply:ip:${clientIp(req)}`, 5, 3_600_000);
    const body = await readJson(req);
    const name = reqStr(body, "name", "Tu nombre", { max: 80 });
    const rawPhone = reqStr(body, "phone", "Tu teléfono");
    const bio = reqStr(body, "bio", "Una breve presentación", { max: 600 });
    const zoneId = reqStr(body, "zoneId", "Tu zona");
    const experienceYears = reqNum(body, "experienceYears", "Los años de experiencia", {
      min: 0,
      max: 50,
    });
    const selfieUrl = optStr(body, "selfieUrl", { max: 300 }) ?? null;
    const idPhotoUrl = optStr(body, "idPhotoUrl", { max: 300 }) ?? null;

    const phone = requirePhone(rawPhone);

    const zone = await db.zone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.active) throw new ApiError(400, "La zona seleccionada no existe.");

    const existing = await db.user.findUnique({ where: { phone } });
    if (existing) {
      throw new ApiError(400, "Ese teléfono ya está registrado. Inicia sesión con él.");
    }

    const cfg = await getAppConfig();
    const user = await db.user.create({
      data: {
        phone,
        name,
        role: "WALKER",
        avatarUrl: selfieUrl,
        zoneId,
        walker: {
          create: {
            status: "PENDING",
            bio,
            experienceYears,
            zoneId,
            price30Cents: cfg.pricing.price30Cents,
            price45Cents: cfg.pricing.price45Cents,
            price60Cents: cfg.pricing.price60Cents,
            selfieUrl,
            idPhotoUrl,
          },
        },
      },
      include: { walker: true, zone: true },
    });

    // Default availability while the admin approves: Mon–Sat 06:30–11:30
    const avail: { walkerId: string; dayOfWeek: number; startMinute: number; endMinute: number }[] = [];
    for (let d = 1; d <= 6; d++) avail.push({ walkerId: user.walker!.id, dayOfWeek: d, startMinute: 390, endMinute: 690 });
    await db.availabilitySlot.createMany({ data: avail });

    await notifyAdmins(
      "APPLICATION",
      "Nueva solicitud de paseador 📋",
      `${name} aplicó como paseador en ${zone.name} (${experienceYears} años de experiencia). Revisa sus documentos.`,
      "applications"
    );
    await notify(
      user.id,
      "APPLICATION",
      "Solicitud recibida 🐾",
      `Recibimos tu solicitud, ${name}. Te avisaremos cuando el equipo FiruWalk la revise (normalmente en menos de 24 h).`,
      null
    );
    return ok({ applied: true });
  });
}
