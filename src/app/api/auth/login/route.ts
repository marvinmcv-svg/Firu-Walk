// POST /api/auth/login {phone, code} → LoginResponse
// Demo OTP login: code checked against config.demo.otpCode.
// Unknown phone → new OWNER named "Nuevo usuario" (isNew: true).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { getAppConfig } from "@/lib/server/config";
import { sessionUserOf } from "@/lib/server/serialize";
import { notify } from "@/lib/server/notify";

/** Loose E.164-ish normalization: spaces/dashes out, default +591 for bare 8-digit numbers. */
function normalizePhone(raw: string): string {
  const trimmed = raw.replace(/[\s\-().]/g, "");
  if (/^\+5917\d{7}$/.test(trimmed)) return trimmed;
  if (/^5917\d{7}$/.test(trimmed)) return `+${trimmed}`;
  if (/^7\d{7}$/.test(trimmed)) return `+591${trimmed}`;
  return trimmed;
}

export async function POST(req: Request) {
  return run(async () => {
    const body = await readJson(req);
    const phone = normalizePhone(reqStr(body, "phone", "El teléfono"));
    const code = reqStr(body, "code", "El código de verificación");

    const cfg = await getAppConfig();
    if (code !== cfg.demo.otpCode) {
      throw new ApiError(400, "Código incorrecto. En la demo el código es " + cfg.demo.otpCode + ".");
    }
    if (!/^\+\d{6,15}$/.test(phone)) {
      throw new ApiError(400, "El teléfono es inválido (usa formato +5917xxxxxxx).");
    }

    const existing = await db.user.findUnique({
      where: { phone },
      include: { walker: true, zone: true },
    });
    if (existing) {
      return ok({ user: sessionUserOf(existing), isNew: false });
    }

    const created = await db.user.create({
      data: { phone, name: "Nuevo usuario", role: "OWNER" },
      include: { walker: true, zone: true },
    });
    await notify(
      created.id,
      "SYSTEM",
      "¡Bienvenido a FiruWalk! 🐾",
      "Completa tu perfil y registra a tu perrito para reservar su primer paseo.",
      "profile"
    );
    return ok({ user: sessionUserOf(created), isNew: true });
  });
}
