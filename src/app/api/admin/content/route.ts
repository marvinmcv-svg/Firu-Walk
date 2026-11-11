// GET  /api/admin/content → ContentOverviewDTO (features, consented walk
//      photos, candidate dogs and walkers, consent counts)
// POST /api/admin/content {kind, month, dogId|walkerId, headline, blurb, photoUrl?, published?} → FeatureDTO
//   FIRU_OF_MONTH: the dog's owner must consent; one published per month.
//   WALKER_SPOTLIGHT: an ACTIVE walker who consents.
//   photoUrl: one of the subject's own photos.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import {
  assertFiruMonthFree,
  assertPhotoAllowed,
  contentOverview,
  featureOf,
  loadFeature,
} from "@/lib/server/content";
import { FeatureCreate } from "./schema";

export async function GET(req: Request) {
  return run(async () => {
    await requireAdmin(req);
    return ok(await contentOverview());
  });
}

export async function POST(req: Request) {
  return run(async () => {
    const admin = await requireAdmin(req);
    const parsed = FeatureCreate.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const { kind, month, dogId, walkerId, headline, blurb, published } = parsed.data;
    const photoUrl = parsed.data.photoUrl || null;

    let subject: { dogId: string | null; walkerId: string | null };
    if (kind === "FIRU_OF_MONTH") {
      if (!dogId) throw new ApiError(400, "Elige el perro.");
      const dog = await db.dog.findUnique({ where: { id: dogId }, include: { owner: true } });
      if (!dog) throw new ApiError(404, "Perro no encontrado.");
      if (!dog.owner.mediaConsent) {
        throw new ApiError(400, "El dueño no autorizó el uso de fotos de su perro.");
      }
      if (published) await assertFiruMonthFree(month);
      await assertPhotoAllowed(photoUrl, { dogId });
      subject = { dogId, walkerId: null };
    } else {
      if (!walkerId) throw new ApiError(400, "Elige el paseador.");
      const walker = await db.user.findUnique({ where: { id: walkerId }, include: { walker: true } });
      if (!walker?.walker) throw new ApiError(404, "Paseador no encontrado.");
      if (walker.walker.status !== "ACTIVE") throw new ApiError(400, "El paseador no está activo.");
      if (!walker.walker.spotlightConsent) {
        throw new ApiError(400, "El paseador no autorizó aparecer como destacado.");
      }
      await assertPhotoAllowed(photoUrl, { walkerAvatar: walker.avatarUrl });
      subject = { dogId: null, walkerId };
    }

    const created = await db.feature.create({
      data: { kind, month, ...subject, headline, blurb, photoUrl, published, createdById: admin.id },
    });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "FEATURE_CREATED",
        entity: "feature",
        entityId: created.id,
        detail: JSON.stringify({ kind, month, ...subject, published }),
      },
    });
    return ok(featureOf(await loadFeature(created.id)), { status: 201 });
  });
}
