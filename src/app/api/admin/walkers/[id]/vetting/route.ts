// GET /api/admin/walkers/[id]/vetting → WalkerVettingDTO with short-lived
// (5 min) signed view links. Admin only; every view is audit-logged.

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getStorage, storageProviderName } from "@/lib/server/storage";
import { latestByKind, loadVetting, VIEW_TTL_SEC, vettingOf } from "@/lib/server/walkerVetting";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const p = await loadVetting(id);
    if (!p) throw new ApiError(404, "Perfil de paseador no encontrado.");

    const urls = new Map<string, string>();
    const latest = [...latestByKind(p.documents).values()];
    if (latest.length && storageProviderName()) {
      const storage = getStorage();
      for (const d of latest) urls.set(d.id, await storage.presignGet(d.storageKey, VIEW_TTL_SEC));
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "WALKER_DOCS_VIEWED",
          entity: "walkerProfile",
          entityId: p.id,
          detail: latest.map((d) => d.kind).join(","),
        },
      });
    }
    return ok(vettingOf(p, p.documents, urls));
  });
}
