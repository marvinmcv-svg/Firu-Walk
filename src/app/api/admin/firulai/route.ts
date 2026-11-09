// GET /api/admin/firulai → FirulAI usage (last 14 days, all visitors) and the
// 50 most recent conversations (admins only).

import { db } from "@/lib/db";
import { ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { boDateKey } from "@/lib/server/botime";
import type { FirulaiAdminDTO } from "@/lib/firu/types";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    const since = boDateKey(new Date(Date.now() - 13 * 86_400_000));
    const [days, convs] = await Promise.all([
      db.aiUsageDay.findMany({ where: { key: "global", day: { gte: since } }, orderBy: { day: "desc" } }),
      db.aiConversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: { messages: { where: { role: "user" }, orderBy: { createdAt: "asc" }, take: 1 } },
      }),
    ]);
    const users = new Map(
      (
        await db.user.findMany({
          where: { id: { in: convs.map((c) => c.userId).filter((x): x is string => !!x) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name])
    );
    const body: FirulaiAdminDTO = {
      days: days.map((d) => ({
        day: d.day,
        requests: d.requests,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        costMicroUsd: d.costMicroUsd,
      })),
      conversations: convs.map((c) => ({
        id: c.id,
        userName: c.userId ? (users.get(c.userId) ?? null) : null,
        lang: c.lang,
        messageCount: c.messageCount,
        costMicroUsd: c.costMicroUsd,
        handoff: c.handoff,
        preview: c.messages[0]?.content.slice(0, 140) ?? "",
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
    return ok(body);
  });
}
