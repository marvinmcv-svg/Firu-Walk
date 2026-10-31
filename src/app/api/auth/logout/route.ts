// POST /api/auth/logout → {ok:true}; revokes the session and clears the cookie.

import { ok, run } from "@/lib/server/http";
import { clearSessionCookie, revokeSession } from "@/lib/server/session";

export async function POST(req: Request) {
  return run(async () => {
    await revokeSession(req);
    const res = ok({ ok: true });
    clearSessionCookie(res, req);
    return res;
  });
}
