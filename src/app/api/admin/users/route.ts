// GET /api/admin/users → SessionUserDTO[] (all users)

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { sessionUserOf } from "@/lib/server/serialize";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const users = await db.user.findMany({
      include: { walker: true, zone: true },
      orderBy: { createdAt: "asc" },
    });
    return ok(users.map(sessionUserOf));
  });
}
