// GET /api/users/me → SessionUserDTO
// PATCH /api/users/me {name?, zoneId?, addressNote?, addressLat?, addressLng?,
//   mediaConsent? (owner: walk photos / dog on social media + landing),
//   spotlightConsent? (walker: be featured as a walker spotlight)}
// Consent changes are timestamped and written to the audit log.

import { db } from "@/lib/db";
import { ApiError, ok, optNum, optStr, readJson, run } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { sessionUserOf } from "@/lib/server/serialize";
import { usableZone } from "@/lib/server/cities";

export async function GET(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    return ok(sessionUserOf(user));
  });
}

export async function PATCH(req: Request) {
  return run(async () => {
    const user = await requireUser(req);
    const body = await readJson(req);

    const data: Record<string, unknown> = {};

    const name = optStr(body, "name", { max: 80 });
    if (name !== undefined) data.name = name;

    const zoneId = optStr(body, "zoneId");
    if (zoneId !== undefined) {
      await usableZone(zoneId, "La zona seleccionada no existe.");
      data.zoneId = zoneId;
    }

    const addressNote = optStr(body, "addressNote", { max: 300 });
    if (addressNote !== undefined) data.addressNote = addressNote;

    const addressLat = optNum(body, "addressLat");
    if (addressLat !== undefined) {
      if (addressLat < -90 || addressLat > 90) throw new ApiError(400, "Latitud inválida.");
      data.addressLat = addressLat;
    }
    const addressLng = optNum(body, "addressLng");
    if (addressLng !== undefined) {
      if (addressLng < -180 || addressLng > 180) throw new ApiError(400, "Longitud inválida.");
      data.addressLng = addressLng;
    }

    const consents: Record<string, boolean> = {};
    if (typeof body.mediaConsent === "boolean") {
      if (user.role !== "OWNER") throw new ApiError(400, "Solo los dueños autorizan el uso de fotos de sus perros.");
      if (body.mediaConsent !== user.mediaConsent) {
        data.mediaConsent = body.mediaConsent;
        data.mediaConsentAt = new Date();
        consents.mediaConsent = body.mediaConsent;
      }
    }
    let walkerData: Record<string, unknown> | null = null;
    if (typeof body.spotlightConsent === "boolean") {
      if (!user.walker) throw new ApiError(400, "Solo los paseadores pueden aparecer como destacados.");
      if (body.spotlightConsent !== user.walker.spotlightConsent) {
        walkerData = { spotlightConsent: body.spotlightConsent, spotlightConsentAt: new Date() };
        consents.spotlightConsent = body.spotlightConsent;
      }
    }

    const consentOnly = typeof body.mediaConsent === "boolean" || typeof body.spotlightConsent === "boolean";
    if (Object.keys(data).length === 0 && !walkerData && !consentOnly) {
      throw new ApiError(400, "Nada que actualizar.");
    }

    const updated = await db.$transaction(async (tx) => {
      if (walkerData) await tx.walkerProfile.update({ where: { userId: user.id }, data: walkerData });
      if (Object.keys(consents).length > 0) {
        await tx.auditLog.create({
          data: { actorId: user.id, action: "CONSENT_CHANGED", entity: "user", entityId: user.id, detail: JSON.stringify(consents) },
        });
      }
      return tx.user.update({
        where: { id: user.id },
        data,
        include: { walker: true, zone: true },
      });
    });
    return ok(sessionUserOf(updated));
  });
}
