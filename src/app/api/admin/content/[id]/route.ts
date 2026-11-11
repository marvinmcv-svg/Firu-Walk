// PATCH  /api/admin/content/[id] {headline?, blurb?, photoUrl?, published?} → FeatureDTO
// DELETE /api/admin/content/[id] → {ok:true}
// The subject (dog / walker), kind and month never change: create another.

import { db } from "@/lib/db";
import { ApiError, ok, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { assertFiruMonthFree, assertPhotoAllowed, featureOf, loadFeature } from "@/lib/server/content";
import { FeatureEdit } from "../schema";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const parsed = FeatureEdit.partial().safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const data = { ...parsed.data, ...(parsed.data.photoUrl === "" ? { photoUrl: null } : {}) };
    if (Object.keys(data).length === 0) throw new ApiError(400, "No hay cambios válidos que aplicar.");
    const f = await loadFeature(id);
    if (data.published === true && f.kind === "FIRU_OF_MONTH") await assertFiruMonthFree(f.month, f.id);
    if (data.photoUrl) {
      await assertPhotoAllowed(data.photoUrl, { dogId: f.dogId, walkerAvatar: f.walker?.avatarUrl });
    }
    await db.feature.update({ where: { id }, data });
    await db.auditLog.create({
      data: { actorId: admin.id, action: "FEATURE_UPDATED", entity: "feature", entityId: id, detail: JSON.stringify(data) },
    });
    return ok(featureOf(await loadFeature(id)));
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const f = await loadFeature(id);
    await db.feature.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "FEATURE_DELETED",
        entity: "feature",
        entityId: id,
        detail: JSON.stringify({ kind: f.kind, month: f.month, dogId: f.dogId, walkerId: f.walkerId }),
      },
    });
    return ok({ ok: true });
  });
}
