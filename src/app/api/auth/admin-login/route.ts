// POST /api/auth/admin-login {username, password} → LoginResponse + session cookie
// Team sign-in for operations. Credentials live in the environment only:
//   ADMIN_USERNAME       e.g. "FiruWalk"
//   ADMIN_PASSWORD_HASH  output of `bun scripts/hash-password.ts '<password>'`
// Signs in as the oldest ADMIN user (created once if none exists).

import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { verifyPassword } from "@/lib/server/auth/password";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { clientIp } from "@/lib/server/request";
import { sessionUserOf } from "@/lib/server/serialize";
import { createSession, setSessionCookie } from "@/lib/server/session";

const BAD = "Usuario o contraseña incorrectos.";

function sameText(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function POST(req: Request) {
  return run(async () => {
    const ip = clientIp(req);
    await enforceRateLimit(`admin-login:ip:${ip}`, 10, 15 * 60_000);

    const body = await readJson(req);
    const username = reqStr(body, "username", "El usuario", { max: 60 }).trim();
    const password = reqStr(body, "password", "La contraseña", { max: 200 });

    const envUser = process.env.ADMIN_USERNAME;
    const envHash = process.env.ADMIN_PASSWORD_HASH;
    if (!envUser || !envHash) throw new ApiError(503, "El acceso del equipo no está configurado.");

    // Always run the (slow) hash check so timing doesn't reveal the username.
    const passOk = verifyPassword(password, envHash);
    if (!sameText(username, envUser) || !passOk) {
      await enforceRateLimit(`admin-login:fail:${ip}`, 5, 15 * 60_000);
      throw new ApiError(401, BAD);
    }

    let user = await db.user.findFirst({
      where: { role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      include: { walker: true, zone: true },
    });
    if (!user) {
      user = await db.user.create({
        data: { phone: `admin:${envUser.toLowerCase()}`, name: "Equipo FiruWalk", role: "ADMIN" },
        include: { walker: true, zone: true },
      });
    }
    await db.auditLog.create({
      data: { action: "ADMIN_PASSWORD_LOGIN", entity: "User", entityId: user.id, detail: `ip ${ip}` },
    });

    const res = ok({ user: sessionUserOf(user), isNew: false });
    setSessionCookie(res, await createSession(user.id, req), req);
    return res;
  });
}
