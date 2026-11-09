// POST /api/walkers/me/documents/[id]/complete → WalkerVettingDTO
// Verifies the object really landed in storage with an allowed type and
// size, marks it uploaded and removes the walker's previous file of the
// same kind (a re-upload replaces it).

import { db } from "@/lib/db";
import { ApiError, ok, run } from "@/lib/server/http";
import { requireWalker } from "@/lib/server/session";
import { getStorage } from "@/lib/server/storage";
import { log } from "@/lib/server/log";
import { DOC_RULES, loadVetting, vettingOf } from "@/lib/server/walkerVetting";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const user = await requireWalker(req);
    const walker = user.walker;
    if (!walker) throw new ApiError(404, "No tienes un perfil de paseador.");

    const doc = await db.walkerDocument.findUnique({ where: { id } });
    // Someone else's document is indistinguishable from a missing one.
    if (!doc || doc.walkerId !== walker.id) throw new ApiError(404, "Documento no encontrado.");
    if (walker.status !== "PENDING") {
      throw new ApiError(409, "Solo puedes subir documentos mientras tu solicitud está en revisión.");
    }

    if (!doc.uploadedAt) {
      const storage = getStorage();
      const info = await storage.head(doc.storageKey);
      if (!info) throw new ApiError(400, "No recibimos el archivo. Vuelve a intentarlo.");
      const rule = DOC_RULES[doc.kind];
      const type = (info.contentType ?? "").split(";")[0].trim().toLowerCase();
      if (info.sizeBytes > rule.maxBytes || (type && type !== doc.contentType)) {
        await storage.delete(doc.storageKey);
        await db.walkerDocument.delete({ where: { id: doc.id } });
        throw new ApiError(400, "El archivo no coincide con lo declarado. Vuelve a subirlo.");
      }

      const previous = await db.walkerDocument.findMany({
        where: { walkerId: walker.id, kind: doc.kind, id: { not: doc.id } },
      });
      await db.walkerDocument.update({
        where: { id: doc.id },
        data: { uploadedAt: new Date(), sizeBytes: info.sizeBytes },
      });
      for (const old of previous) {
        try {
          await storage.delete(old.storageKey);
          await db.walkerDocument.delete({ where: { id: old.id } });
        } catch (err) {
          log.warn("docs.replace_cleanup_failed", { err, documentId: old.id });
        }
      }
    }

    const p = await loadVetting(walker.id);
    return ok(vettingOf(p!, p!.documents));
  });
}
