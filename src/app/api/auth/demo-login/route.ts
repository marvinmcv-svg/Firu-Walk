// POST /api/auth/demo-login {userId} → LoginResponse + session cookie
// DEMO MODE ONLY: one-click login as a seeded demo account (+59170000xx).

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { isDemoMode, isDemoPhone } from "@/lib/server/auth/demo";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { clientIp } from "@/lib/server/request";
import { sessionUserOf } from "@/lib/server/serialize";
import { createSession, setSessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  return run(async () => {
    if (!isDemoMode()) throw new ApiError(404, "No encontrado.");
    await enforceRateLimit(`demo-login:ip:${clientIp(req)}`, 60, 15 * 60_000);

    const body = await readJson(req);
    const userId = reqStr(body, "userId", "La cuenta demo", { max: 40 });
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { walker: true, zone: true },
    });
    if (!user || !isDemoPhone(user.phone)) {
      throw new ApiError(403, "Solo las cuentas demo admiten acceso directo.");
    }

    const res = ok({ user: sessionUserOf(user), isNew: false });
    setSessionCookie(res, await createSession(user.id, req), req);
    return res;
  });
}
