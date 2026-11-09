// PATCH /api/admin/walkers/[id]/review
// {identityOk?, backgroundOk?, interviewDone?, trialWalkDone?, notes?}
// → WalkerVettingDTO. Updates the vetting checklist (audit-logged).

import { db } from "@/lib/db";
import { ApiError, ok, optStr, readJson, run } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { loadVetting, vettingOf } from "@/lib/server/walkerVetting";

const FIELDS = {
  identityOk: "reviewIdentityOk",
  backgroundOk: "reviewBackgroundOk",
  interviewDone: "reviewInterviewDone",
  trialWalkDone: "reviewTrialWalkDone",
} as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await params;
    const admin = await requireAdmin(req);
    const body = await readJson(req);

    const data: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(FIELDS)) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== "boolean") throw new ApiError(400, `El campo "${k}" debe ser verdadero o falso.`);
      data[col] = body[k];
    }
    if (body.notes !== undefined) data.reviewNotes = optStr(body, "notes", { max: 1000 }) ?? null;
    if (!Object.keys(data).length) throw new ApiError(400, "No hay cambios en el checklist.");

    const exists = await db.walkerProfile.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new ApiError(404, "Perfil de paseador no encontrado.");
    await db.walkerProfile.update({
      where: { id },
      data: { ...data, reviewedById: admin.id, reviewedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "WALKER_REVIEW_UPDATED",
        entity: "walkerProfile",
        entityId: id,
        detail: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k]) => k in FIELDS))),
      },
    });
    const p = await loadVetting(id);
    return ok(vettingOf(p!, p!.documents));
  });
}
