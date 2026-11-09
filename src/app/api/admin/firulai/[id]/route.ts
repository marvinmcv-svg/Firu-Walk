// GET /api/admin/firulai/[id] → the messages of one FirulAI conversation (admins only).

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    await requireAdmin(req);
    const conv = await db.aiConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conv) throw new ApiError(404, "Conversación no encontrada.");
    return ok({
      id: conv.id,
      messages: conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        degraded: m.degraded,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });
}
