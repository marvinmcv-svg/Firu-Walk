// POST /api/walkers/apply — PUBLIC application form.
// Requires acceptAgreement: true (Walker Agreement + Terms + Privacy); the
// accepted LEGAL_VERSION is recorded on the user and the walker profile.
// Creates User(role WALKER) + WalkerProfile(status PENDING) + default availability.
// The phone becomes the login (the applicant signs in later with a login code).
// Returns {applied:true}; it never opens a session. Identity documents are
// uploaded afterwards from the walker app (signed in), never through this
// public form — see /api/walkers/me/documents.

import { db } from "@/lib/db";
import { usableZone } from "@/lib/server/cities";
import { LEGAL_VERSION } from "@/lib/firu/legal";
import { ApiError, ok, readJson, reqNum, reqStr, run } from "@/lib/server/http";
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

    const phone = requirePhone(rawPhone);
    if (body.acceptAgreement !== true) {
      throw new ApiError(400, "Debes aceptar el Acuerdo de Paseadores, los Términos y la Política de Privacidad.");
    }

    const zone = await usableZone(zoneId, "La zona seleccionada no existe.");

    const existing = await db.user.findUnique({ where: { phone } });
    if (existing) {
      throw new ApiError(400, "Ese teléfono ya está registrado. Inicia sesión con él.");
    }

    const now = new Date();
    const user = await db.user.create({
      data: {
        phone,
        name,
        role: "WALKER",
        zoneId,
        termsVersion: LEGAL_VERSION,
        termsAcceptedAt: now,
        walker: {
          create: {
            status: "PENDING",
            agreementVersion: LEGAL_VERSION,
            agreementAcceptedAt: now,
            bio,
            experienceYears,
            zoneId,
            // The city's base prices; the walker adjusts them later.
            price30Cents: zone.cityRef.price30Cents,
            price45Cents: zone.cityRef.price45Cents,
            price60Cents: zone.cityRef.price60Cents,
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
