// PUT /api/walkers/me/id-number {idNumber} → WalkerVettingDTO
// Stores the CI number AES-256-GCM encrypted; only the last 4 digits are
// kept in clear for display. The full number is never returned by any API.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, reqStr, run } from "@/lib/server/http";
import { ciLast4, encryptField, normalizeCi } from "@/lib/server/crypto/fieldCrypto";
import { requireWalker } from "@/lib/server/session";
import { loadVetting, vettingOf } from "@/lib/server/walkerVetting";

export async function PUT(req: Request) {
  return run(async () => {
    const user = await requireWalker(req);
    const walker = user.walker;
    if (!walker) throw new ApiError(404, "No tienes un perfil de paseador.");
    if (walker.status !== "PENDING") {
      throw new ApiError(409, "Tu CI solo puede cambiarse mientras tu solicitud está en revisión.");
    }
    const body = await readJson(req);
    const ci = normalizeCi(reqStr(body, "idNumber", "El número de CI", { max: 20 }));
    if (!/^\d{5,10}[0-9A-Z]{0,4}$/.test(ci)) {
      throw new ApiError(400, "Revisa tu número de CI (solo números, con extensión opcional).");
    }
    await db.walkerProfile.update({
      where: { id: walker.id },
      data: { idDocCipher: encryptField(ci), idDocLast4: ciLast4(ci) },
    });
    const p = await loadVetting(walker.id);
    return ok(vettingOf(p!, p!.documents));
  });
}
