// POST /api/auth/login {phone, code, acceptTerms} → LoginResponse + session cookie
// Verifies the code from POST /api/auth/otp. Unknown phone → new OWNER named
// "Nuevo usuario" (isNew: true) — only with acceptTerms: true (Terms, Privacy
// and Cancellation policy). The accepted LEGAL_VERSION is recorded; existing
// users are updated when they accept a newer version. ADMIN accounts are
// never created here.

import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/firu/legal";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { verifyLoginCode } from "@/lib/server/auth/otp";
import { requirePhone } from "@/lib/server/auth/phone";
import { notify } from "@/lib/server/notify";
import { clientIp } from "@/lib/server/request";
import { sessionUserOf } from "@/lib/server/serialize";
import { createSession, setSessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  return run(async () => {
    const body = await readJson(req);
    const phone = requirePhone(reqStr(body, "phone", "El teléfono", { max: 30 }));
    const code = reqStr(body, "code", "El código de verificación", { max: 10 });

    const acceptTerms = body.acceptTerms === true;

    // Code first, so this answer can't be used to probe which phones exist.
    await verifyLoginCode(phone, code, clientIp(req));

    let user = await db.user.findUnique({ where: { phone }, include: { walker: true, zone: true } });
    if (!user && !acceptTerms) {
      throw new ApiError(400, "Para crear tu cuenta debes aceptar los Términos y la Política de Privacidad.");
    }

    const now = new Date();
    const isNew = !user;
    if (!user) {
      user = await db.user.create({
        data: { phone, name: "Nuevo usuario", role: "OWNER", termsVersion: LEGAL_VERSION, termsAcceptedAt: now },
        include: { walker: true, zone: true },
      });
      await notify(
        user.id,
        "SYSTEM",
        "¡Bienvenido a FiruWalk! 🐾",
        "Completa tu perfil y registra a tu perrito para reservar su primer paseo.",
        "profile"
      );
    } else if (acceptTerms && user.termsVersion !== LEGAL_VERSION) {
      await db.user.update({ where: { id: user.id }, data: { termsVersion: LEGAL_VERSION, termsAcceptedAt: now } });
    }

    const res = ok({ user: sessionUserOf(user), isNew });
    setSessionCookie(res, await createSession(user.id, req), req);
    return res;
  });
}
