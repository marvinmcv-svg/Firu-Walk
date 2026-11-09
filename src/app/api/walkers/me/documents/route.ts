// POST /api/walkers/me/documents {kind, contentType, sizeBytes}
//   → DocumentUploadTicketDTO: a presigned PUT straight to private storage
//   (valid 10 min). The document only counts once /complete verifies it.
// Only while the application is under review (PENDING).

import type { WalkerDocKind } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError, ok, oneOf, readJson, reqNum, reqStr, run } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { requireWalker } from "@/lib/server/session";
import { getStorage, StorageUnavailable } from "@/lib/server/storage";
import { DOC_KINDS, DOC_RULES, UPLOAD_TTL_SEC } from "@/lib/server/walkerVetting";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export async function POST(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    const walker = user.walker;
    if (!walker) throw new ApiError(404, "No tienes un perfil de paseador.");
    if (walker.status !== "PENDING") {
      throw new ApiError(409, "Solo puedes subir documentos mientras tu solicitud está en revisión.");
    }
    await enforceRateLimit(`docs:upload:${walker.id}`, 30, 3_600_000);

    const body = await readJson(req);
    const kind = oneOf(body.kind, DOC_KINDS, "El tipo de documento") as WalkerDocKind;
    const contentType = reqStr(body, "contentType", "El tipo de archivo", { max: 60 }).toLowerCase();
    const sizeBytes = reqNum(body, "sizeBytes", "El tamaño del archivo", { min: 1, max: 1e9 });
    const rule = DOC_RULES[kind];
    if (!rule.types.includes(contentType)) {
      throw new ApiError(400, "Ese tipo de archivo no está permitido para este documento.");
    }
    if (sizeBytes > rule.maxBytes) {
      throw new ApiError(400, `El archivo es demasiado grande (máx. ${Math.round(rule.maxBytes / 1048576)} MB).`);
    }

    let storage;
    try {
      storage = getStorage();
    } catch (e) {
      if (e instanceof StorageUnavailable) {
        throw new ApiError(503, "La subida de documentos aún no está disponible. Inténtalo más tarde.");
      }
      throw e;
    }

    // Unguessable key, scoped to the walker; no user input in the path.
    const storageKey = `walkers/${walker.id}/${kind.toLowerCase()}/${randomBytes(16).toString("hex")}.${EXT[contentType]}`;
    const doc = await db.walkerDocument.create({
      data: { walkerId: walker.id, kind, storageKey, contentType, sizeBytes: Math.round(sizeBytes) },
    });
    const put = await storage.presignPut(storageKey, contentType, UPLOAD_TTL_SEC);
    return ok({ documentId: doc.id, ...put, maxBytes: rule.maxBytes });
  });
}
